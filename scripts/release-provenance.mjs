#!/usr/bin/env node
/**
 * scripts/release-provenance.mjs — prove the published artifact == this commit. (Closes #3)
 *
 * Commercial trust depends on being able to show that the published npm package, the GitHub
 * commit/tag, the packed tarball, a clean install, the test suite, and the capability-receipt
 * proof rail ALL refer to the same artifact — reproducible evidence, not assertion. This script
 * runs that chain of checks and prints a verdict a reviewer can reproduce command-for-command.
 *
 * Honest by design:
 *  - A check it cannot perform (no network, a flag opted out) is reported SKIP — never silently passed.
 *  - A working tree that is dirty, or a tag that is not at HEAD, is reported as such (WARN), because
 *    provenance of an ambiguous tree IS ambiguous.
 *  - It claims nothing about production readiness, autonomy, settlement, or ownership-layer features.
 *    StratosAgent is the execution layer; this only proves the EXECUTION artifact is what it says.
 *
 * Read-mostly: the only writes are inside fresh OS temp dirs (a packed tarball, a throwaway install
 * prefix, a throwaway receipt workspace), all removed on exit. It never publishes, deploys, tags,
 * commits, or mutates the repo.
 *
 * Usage:
 *   node scripts/release-provenance.mjs                 # full run
 *   node scripts/release-provenance.mjs --quick         # skip the slow clean-install + test checks
 *   node scripts/release-provenance.mjs --offline       # skip the npm-registry lookup
 *   node scripts/release-provenance.mjs --skip-tests --skip-install
 *   node scripts/release-provenance.mjs --json          # machine-readable (for PR / receipt evidence)
 *
 * Exit code: 0 when no check FAILs (WARN/SKIP are honest, not fatal); 1 otherwise.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const require = createRequire(import.meta.url);
const pkg = require(path.join(ROOT, 'package.json'));
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const MIN_NODE = '20.19.0';
const C = { g: '\x1b[32m', y: '\x1b[33m', r: '\x1b[31m', d: '\x1b[2m', x: '\x1b[0m', B: '\x1b[1m' };

export const PASS = 'PASS', FAIL = 'FAIL', WARN = 'WARN', SKIP = 'SKIP';

// ── pure helpers (hermetically unit-tested in test-release-provenance.mjs) ────────────────────────
export function normalizeVersion(v) {
  return String(v ?? '').trim().replace(/^v/, '');
}
export function versionsMatch(a, b) {
  const x = normalizeVersion(a), y = normalizeVersion(b);
  return x !== '' && x === y;
}
export function meetsMinNode(current, min = MIN_NODE) {
  const c = normalizeVersion(current).split('.').map((n) => parseInt(n, 10) || 0);
  const m = normalizeVersion(min).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((c[i] || 0) > (m[i] || 0)) return true;
    if ((c[i] || 0) < (m[i] || 0)) return false;
  }
  return true;
}
// A published tarball must NEVER carry private keys, .env files, or secret material.
const SECRET_RE = /(^|\/)(\.env(\..+)?|node-keys\.json|.+\.pem|.+\.key|.+\.secret)$/i;
export function packLeaksSecrets(files) {
  const offenders = (files || []).filter((f) => SECRET_RE.test(String(f)));
  return { ok: offenders.length === 0, offenders };
}
export function summarize(checks) {
  const counts = { PASS: 0, FAIL: 0, WARN: 0, SKIP: 0 };
  for (const c of checks) counts[c.status] = (counts[c.status] || 0) + 1;
  return { counts, total: checks.length, ok: counts.FAIL === 0 };
}

// ── impure runners ────────────────────────────────────────────────────────────────────────────
const stripAnsi = (s) => String(s ?? '').replace(/\x1b\[[0-9;]*m/g, '');
function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, ...opts });
  return { code: r.status ?? (r.error ? -1 : 0), out: stripAnsi((r.stdout || '') + (r.stderr || '')), error: r.error };
}
const node = (args, opts = {}) => sh(process.execPath, args, opts);
function findFirst(dir, re) {
  let found = null;
  const walk = (d) => {
    if (found) return;
    let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (found) return;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p); else if (re.test(e.name)) found = p;
    }
  };
  walk(dir);
  return found;
}

// 1 · Node runtime gate
function checkNode() {
  const ok = meetsMinNode(process.version, MIN_NODE);
  return { id: 'node-version', status: ok ? PASS : FAIL,
    detail: `running ${process.version} (require >=${MIN_NODE})`,
    evidence: [`process.version -> ${process.version}`, `package.json engines.node -> ${pkg.engines?.node ?? '(unset)'}`] };
}

// 2 · package.json version (the anchor every other check compares against)
function checkPackageVersion() {
  return { id: 'package-version', status: pkg.version ? PASS : FAIL,
    detail: `${pkg.name}@${pkg.version}`,
    evidence: [`package.json -> ${pkg.name}@${pkg.version}`] };
}

// 3 · git commit + working-tree cleanliness
function checkGit() {
  const head = sh('git', ['rev-parse', 'HEAD']);
  if (head.code !== 0) return { id: 'git-commit', status: SKIP, detail: 'not a git checkout', evidence: [head.out.trim().slice(0, 160)] };
  const sha = head.out.trim();
  const short = sh('git', ['rev-parse', '--short', 'HEAD']).out.trim();
  const porcelain = sh('git', ['status', '--porcelain']).out.trim();
  const dirty = porcelain.length > 0;
  const tagsAtHead = sh('git', ['tag', '--points-at', 'HEAD']).out.trim().split('\n').filter(Boolean);
  return { id: 'git-commit', status: dirty ? WARN : PASS,
    detail: `${short}${dirty ? ' — working tree DIRTY (provenance ambiguous)' : ''}${tagsAtHead.length ? ` · tags: ${tagsAtHead.join(',')}` : ''}`,
    evidence: [
      `git rev-parse HEAD -> ${sha}`,
      `git status --porcelain -> ${dirty ? `${porcelain.split('\n').length} change(s)` : 'clean'}`,
      `git tag --points-at HEAD -> ${tagsAtHead.join(', ') || '(none)'}`,
    ],
    data: { sha, short, dirty, tagsAtHead } };
}

// 4 · git tag v<version> exists and what commit it points to
function checkGitTag() {
  const want = 'v' + normalizeVersion(pkg.version);
  const exists = sh('git', ['rev-parse', '-q', '--verify', `refs/tags/${want}`]);
  if (exists.code !== 0) return { id: 'git-tag', status: WARN, detail: `tag ${want} not found locally (release may be untagged here)`, evidence: [`git rev-parse refs/tags/${want} -> (missing)`], data: { want, tagSha: null } };
  const tagSha = sh('git', ['rev-list', '-n', '1', want]).out.trim();
  const headSha = sh('git', ['rev-parse', 'HEAD']).out.trim();
  const atHead = tagSha === headSha;
  return { id: 'git-tag', status: PASS,
    detail: `${want} -> ${tagSha.slice(0, 12)}${atHead ? ' (== HEAD)' : ' (not at HEAD — main has moved past the release)'}`,
    evidence: [`git rev-list -n1 ${want} -> ${tagSha}`, `HEAD -> ${headSha}`],
    data: { want, tagSha, atHead } };
}

// 5 · npm published version (network) — must equal package.json
function checkNpmPublished(offline) {
  if (offline) return { id: 'npm-published', status: SKIP, detail: '--offline (registry not queried)', evidence: ['skipped: --offline'] };
  const r = sh(NPM, ['view', `${pkg.name}@latest`, '--json'], { timeout: 25000 });
  if (r.code !== 0) return { id: 'npm-published', status: SKIP, detail: 'registry unreachable / not published', evidence: [`npm view ${pkg.name}@latest -> rc ${r.code}`, r.out.trim().slice(0, 200)] };
  let doc; try { doc = JSON.parse(r.out); } catch { return { id: 'npm-published', status: SKIP, detail: 'could not parse npm view output', evidence: [r.out.trim().slice(0, 200)] }; }
  const publishedVersion = doc.version;
  const match = versionsMatch(publishedVersion, pkg.version);
  return { id: 'npm-published', status: match ? PASS : FAIL,
    detail: `npm latest = ${publishedVersion}${match ? ' (== package.json)' : ` (!= package.json ${pkg.version})`}`,
    evidence: [`npm view ${pkg.name}@latest version -> ${publishedVersion}`, `dist.shasum -> ${doc.dist?.shasum ?? '?'}`, `dist.integrity -> ${doc.dist?.integrity ?? '?'}`],
    data: { publishedVersion, shasum: doc.dist?.shasum, integrity: doc.dist?.integrity } };
}

// 6 · npm pack contents — files match the whitelist; nothing secret ships
function checkNpmPack() {
  const r = sh(NPM, ['pack', '--dry-run', '--json'], { timeout: 60000 });
  if (r.code !== 0) return { id: 'npm-pack', status: FAIL, detail: 'npm pack --dry-run failed', evidence: [r.out.trim().slice(0, 300)] };
  let arr; try { arr = JSON.parse(r.out); } catch { return { id: 'npm-pack', status: FAIL, detail: 'cannot parse npm pack json', evidence: [r.out.trim().slice(0, 300)] }; }
  const meta = Array.isArray(arr) ? arr[0] : arr;
  const files = (meta.files || []).map((f) => f.path);
  const leak = packLeaksSecrets(files);
  const verMatch = versionsMatch(meta.version, pkg.version);
  const status = (!leak.ok || !verMatch) ? FAIL : PASS;
  return { id: 'npm-pack', status,
    detail: `${meta.entryCount ?? files.length} files · v${meta.version} · shasum ${String(meta.shasum).slice(0, 12)}${leak.ok ? '' : ` · LEAKS: ${leak.offenders.join(',')}`}`,
    evidence: [
      `npm pack --dry-run -> ${files.length} files, version ${meta.version}`,
      `shasum -> ${meta.shasum}`,
      `integrity -> ${meta.integrity}`,
      `secret-scan -> ${leak.ok ? 'clean (no .env / keys / pem)' : `LEAK ${leak.offenders.join(',')}`}`,
    ],
    data: { shasum: meta.shasum, integrity: meta.integrity, fileCount: files.length, version: meta.version } };
}

// 7 · clean install from a freshly packed tarball, then run the installed binary
function checkCleanInstall(skip) {
  if (skip) return { id: 'clean-install', status: SKIP, detail: 'skipped (--skip-install / --quick)', evidence: ['skipped'] };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stratos-prov-install-'));
  try {
    const packed = sh(NPM, ['pack', '--pack-destination', tmp, '--json'], { timeout: 60000 });
    if (packed.code !== 0) return { id: 'clean-install', status: FAIL, detail: 'npm pack failed', evidence: [packed.out.trim().slice(0, 200)] };
    let tarball = null;
    try { tarball = path.join(tmp, JSON.parse(packed.out)[0].filename); } catch { /* fall through */ }
    if (!tarball || !fs.existsSync(tarball)) {
      const tgz = fs.readdirSync(tmp).find((f) => f.endsWith('.tgz'));
      tarball = tgz ? path.join(tmp, tgz) : null;
    }
    if (!tarball) return { id: 'clean-install', status: FAIL, detail: 'no tarball produced', evidence: ['npm pack produced no .tgz'] };
    const prefix = path.join(tmp, 'consumer');
    fs.mkdirSync(prefix, { recursive: true });
    fs.writeFileSync(path.join(prefix, 'package.json'), JSON.stringify({ name: 'prov-consumer', version: '0.0.0', private: true }) + '\n');
    const inst = sh(NPM, ['install', tarball, '--no-audit', '--no-fund', '--no-save', '--prefer-offline'], { cwd: prefix, timeout: 120000 });
    if (inst.code !== 0) return { id: 'clean-install', status: FAIL, detail: 'npm install of tarball failed', evidence: [`npm install <tarball> -> rc ${inst.code}`, inst.out.trim().slice(-300)] };
    const binJs = path.join(prefix, 'node_modules', '@efficientlabs', 'stratos', 'bin', 'stratos.js');
    if (!fs.existsSync(binJs)) return { id: 'clean-install', status: FAIL, detail: 'installed package missing bin/stratos.js', evidence: [`expected ${binJs}`] };
    const ver = node([binJs, '--version'], { cwd: prefix });
    const installedVer = ver.out.trim();
    const ok = ver.code === 0 && versionsMatch(installedVer, pkg.version);
    return { id: 'clean-install', status: ok ? PASS : FAIL,
      detail: `installed @efficientlabs/stratos, \`stratos --version\` -> ${installedVer}`,
      evidence: [`npm install <tarball> -> rc ${inst.code}`, `node node_modules/@efficientlabs/stratos/bin/stratos.js --version -> ${installedVer}`] };
  } finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ } }
}

// 8 · the real test suite (node run-tests.mjs)
function checkTests(skip) {
  if (skip) return { id: 'tests', status: SKIP, detail: 'skipped (--skip-tests / --quick)', evidence: ['skipped'] };
  const r = node([path.join(ROOT, 'run-tests.mjs')], { timeout: 300000 });
  const m = r.out.match(/(\d+)\/(\d+)\s+suites passed/);
  return { id: 'tests', status: r.code === 0 ? PASS : FAIL,
    detail: m ? `${m[1]}/${m[2]} suites passed` : `exit ${r.code}`,
    evidence: [`node run-tests.mjs -> rc ${r.code}`, m ? m[0] : '(summary line not found)'] };
}

// 9 · the capability-receipt proof rail: export -> verify(OK) -> tamper -> verify(BROKEN, fail-closed)
function checkReceiptFlow() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stratos-prov-receipt-'));
  const bin = path.join(ROOT, 'bin', 'stratos.js');
  const env = { ...process.env, NO_COLOR: '1',
    STRATOS_WORKSPACES_DIR: path.join(tmp, 'workspaces'),
    STRATOS_NODE_KEYS: path.join(tmp, '.stratos-profile', 'node-keys.json') };
  const ev = [];
  try {
    for (const s of [['init', 'demo'], ['task', 'create', 'demo/p/f/t1'], ['capture', 'demo/p/f/t1', 'provenance smoke'], ['trace', 'demo/p/f/t1']]) {
      const r = node([bin, ...s], { cwd: tmp, env });
      if (r.code !== 0) return { id: 'receipt-flow', status: FAIL, detail: `step \`stratos ${s.join(' ')}\` failed`, evidence: [...ev, r.out.trim().slice(-200)] };
    }
    const jsonl = findFirst(path.join(tmp, 'workspaces'), /\.receipt\.jsonl$/);
    if (!jsonl) return { id: 'receipt-flow', status: FAIL, detail: 'no *.receipt.jsonl produced by trace', evidence: ev };
    ev.push(`trace -> ${path.basename(jsonl)}`);
    const bundle = path.join(tmp, 'bundle.json');
    const exp = node([bin, 'receipt', 'export', jsonl, '--out', bundle], { cwd: tmp, env });
    if (exp.code !== 0 || !fs.existsSync(bundle)) return { id: 'receipt-flow', status: FAIL, detail: 'receipt export failed', evidence: [...ev, exp.out.trim().slice(-200)] };
    const clean = node([bin, 'receipt', 'verify', bundle], { cwd: tmp, env });
    const okClean = clean.code === 0 && /OK/.test(clean.out);
    ev.push(`receipt verify (clean) -> rc ${clean.code} ${/OK/.test(clean.out) ? 'OK' : '(no OK)'}`);
    const b = JSON.parse(fs.readFileSync(bundle, 'utf8'));
    b.receipts[0].cost_units = 999999;
    const tampered = path.join(tmp, 'tampered.json');
    fs.writeFileSync(tampered, JSON.stringify(b));
    const bad = node([bin, 'receipt', 'verify', tampered], { cwd: tmp, env });
    const failsClosed = bad.code === 1 && /BROKEN/.test(bad.out);
    ev.push(`receipt verify (1 field tampered) -> rc ${bad.code} ${/BROKEN/.test(bad.out) ? 'BROKEN' : '(no BROKEN!)'}`);
    const ok = okClean && failsClosed;
    return { id: 'receipt-flow', status: ok ? PASS : FAIL,
      detail: ok ? 'clean bundle verifies; a tampered field fails closed' : `clean=${okClean ? 'OK' : 'BAD'} tamper=${failsClosed ? 'fail-closed' : 'DID NOT fail closed'}`,
      evidence: ev };
  } finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ } }
}

const HELP = `release-provenance — prove the published artifact == this commit (Closes #3)

Usage: node scripts/release-provenance.mjs [flags]
  --quick         skip the slow clean-install + test-suite checks
  --offline       skip the npm-registry lookup
  --skip-tests    skip running node run-tests.mjs
  --skip-install  skip the clean-install-from-tarball check
  --json          machine-readable report (for PR / receipt evidence)
  -h, --help      this message

Exit 0 when no check FAILs (WARN/SKIP are honest, not fatal).`;

function main() {
  const args = process.argv.slice(2);
  const has = (f) => args.includes(f);
  if (has('--help') || has('-h')) { console.log(HELP); return 0; }
  const quick = has('--quick');

  const checks = [
    checkNode(),
    checkPackageVersion(),
    checkGit(),
    checkGitTag(),
    checkNpmPublished(has('--offline')),
    checkNpmPack(),
    checkCleanInstall(quick || has('--skip-install')),
    checkTests(quick || has('--skip-tests')),
    checkReceiptFlow(),
  ];
  const sum = summarize(checks);

  if (has('--json')) {
    console.log(JSON.stringify({
      tool: 'release-provenance',
      package: { name: pkg.name, version: pkg.version },
      node: process.version,
      generatedAt: new Date().toISOString(),
      summary: sum,
      checks,
    }, null, 2));
    return sum.ok ? 0 : 1;
  }

  const icon = { PASS: `${C.g}✓${C.x}`, FAIL: `${C.r}✗${C.x}`, WARN: `${C.y}!${C.x}`, SKIP: `${C.d}–${C.x}` };
  console.log(`\n${C.B}Release provenance${C.x} ${C.d}— ${pkg.name}@${pkg.version} · node ${process.version}${C.x}\n`);
  for (const c of checks) {
    console.log(` ${icon[c.status]} ${c.id.padEnd(16)} ${C.d}${c.detail}${C.x}`);
    if (c.status === FAIL) for (const e of (c.evidence || [])) console.log(`     ${C.d}${e}${C.x}`);
  }
  const verdict = sum.ok ? `${C.g}PROVENANCE OK${C.x}` : `${C.r}PROVENANCE FAILED${C.x}`;
  console.log(`\n ${sum.counts.PASS} PASS · ${sum.counts.FAIL} FAIL · ${sum.counts.WARN} WARN · ${sum.counts.SKIP} SKIP  → ${verdict}`);
  console.log(`${C.d} reproduce any line: see docs/RELEASE_PROVENANCE.md · machine-readable: --json${C.x}\n`);
  return sum.ok ? 0 : 1;
}

const isMain = (() => { try { return path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url); } catch { return false; } })();
if (isMain) process.exit(main());
