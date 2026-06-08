/**
 * stratos-cli.js — the public, hermetic StratosAgent CLI core.
 *
 * This is the PUBLIC carve of the `stratos` front door. It exposes only the publicly-auditable
 * operating-core surface — workspace / task / capture / trace / eval, signed-skill (SKILL.md)
 * import/export/verify, the model-routing decision, and capability-receipt verification — none of
 * which reach into the private learning/economic flywheel (skill induction, attribution accounting,
 * self-improvement generation) or the private connector/broker internals. Those commands live only
 * in the private build.
 *
 * Design principles preserved from the full build:
 *  - HONEST: no command prints data it didn't measure. No fabricated status / balance / counts.
 *  - DETERMINISTIC: capture/trace/eval do not call an LLM or the network.
 *  - DENY-BY-DEFAULT: every state-changing command is capability-gated through the same
 *    capability-gate the skill runtime uses.
 *
 * `run(argv, deps)` returns { code, lines, action? } and is unit-tested with injected roots/caps/keys.
 */
import fs from 'node:fs';
import path from 'node:path';

import { ReceiptLog, makeReceiptVerifier, makeReceiptSigner, verifyBundle } from '../ledger/capability-receipt.js';
import { originId } from '../memory/skill-seal.js';
import { route as routeDecision, difficulty } from '../routing/model-router.js';
import { parseCapabilities, assertStepAllowed } from '../security/capability-gate.js';
import { importSkillMd, exportSkillMd } from '../skills/skill-md.js';
import { SkillStore } from '../skills/skill-store.js';
import * as workspaceTree from '../workspace/workspace-tree.js';
import { capture as captureEvent } from '../context/context-capture.js';
import { startTrace, recordStep, endTrace, readTrace } from '../trace/trace-engine.js';
import { evaluate as evaluateTrace } from '../eval/eval-engine.js';
import { generateHybridKeyPair } from '../security/quantum-crypto.js';

const C = { g: '\x1b[32m', y: '\x1b[33m', r: '\x1b[31m', b: '\x1b[36m', d: '\x1b[2m', x: '\x1b[0m', B: '\x1b[1m' };

const _ROOT = path.resolve(process.cwd());
const shortHash = (h) => (h ? String(h).slice(0, 12) : '—');
const didShort = (d) => { const s = String(d || '—'); return s.length > 30 ? s.slice(0, 22) + '…' + s.slice(-6) : s; };

// Branded wordmark for help.
const _F = {
  S: ['█████', '█    ', '█████', '    █', '█████'],
  T: ['█████', '  █  ', '  █  ', '  █  ', '  █  '],
  R: ['████ ', '█   █', '████ ', '█  █ ', '█   █'],
  A: ['█████', '█   █', '█████', '█   █', '█   █'],
  O: ['█████', '█   █', '█   █', '█   █', '█████'],
};
const _WORDMARK = [0, 1, 2, 3, 4]
  .map((r) => '  ' + 'STRATOS'.split('').map((c) => _F[c][r]).join(' '))
  .join('\n');

export function banner() {
  return [
    '',
    C.b + C.B + _WORDMARK + C.x,
    '  ' + C.b + C.B + 'A G E N T' + C.x + C.d + '   ·   sovereign, local-first AI   ·   Efficient Labs' + C.x,
    '  ' + C.d + 'The cloud is a ceiling. ' + C.x + C.b + 'The Atmosphere is limitless.' + C.x,
    '',
  ].join('\n');
}

function helpText() {
  return [
    banner(),
    `${C.B}stratos${C.x} ${C.d}— the publicly-auditable operating core${C.x}`,
    '',
    `  ${C.g}workspace${C.x} create|tree <name>           the files-first operational unit`,
    `  ${C.g}task${C.x}      create <ws/proj/wf/task>      scaffold a task (8 canonical entries)`,
    `  ${C.g}capture${C.x}   <ws/proj/wf/task> "<text>"    classify + persist a context record (deterministic)`,
    `  ${C.g}trace${C.x}     <ws/proj/wf/task>             start→steps→end with a signed receipt spine`,
    `  ${C.g}eval${C.x}      <ws/proj/wf/task>             score a trace against the deterministic rubric`,
    `  ${C.g}skill${C.x}     import|export|list            SKILL.md portability (untrusted-by-default)`,
    `  ${C.g}route${C.x}     "<prompt>" [--privacy]        the local-default routing decision (no call made)`,
    `  ${C.g}receipt${C.x}   verify <bundle.json>          verify a capability-receipt bundle with its public key`,
    `  ${C.g}version${C.x}                                  print the version`,
    '',
    `  ${C.d}Every state-changing command is capability-gated, deny-by-default. capture/trace/eval are`,
    `  deterministic: no LLM, no network. The signed receipt is verifiable with the public key only.${C.x}`,
  ];
}

// ── skill (SKILL.md portability) ────────────────────────────────────────────────────────────────
const SKILL_CAPS = parseCapabilities({ capabilities: { actions: ['skill.import', 'skill.read'] } });

function skillsDir() {
  if (process.env.STRATOS_SKILLS_DIR) return path.resolve(process.env.STRATOS_SKILLS_DIR);
  return path.join(_ROOT, '.stratos-profile', 'skills');
}

async function cmdSkill(rest, d = {}) {
  const sub = (rest[0] || 'help').toLowerCase();
  const caps = d.skillCaps || SKILL_CAPS;
  const store = d.skillStore || new SkillStore(skillsDir());

  if (sub === 'help' || sub === '-h' || sub === '--help') {
    return { code: 0, lines: [
      `${C.B}stratos skill${C.x} ${C.d}— SKILL.md portability (agentskills.io / clawhub compatible)${C.x}`,
      `  ${C.g}import${C.x} <file.md>   Ingest a foreign SKILL.md ${C.d}(UNTRUSTED by default · deny-by-default caps)${C.x}`,
      `  ${C.g}export${C.x} <id>        Emit one of your skills as portable SKILL.md ${C.d}(+ did:atmos provenance)${C.x}`,
      `  ${C.g}list${C.x}              List imported skills + their honest trust label`,
      '',
      `  ${C.d}Imported skills are prose/instruction by default: stored + capability-gated, never auto-run.`,
      `  Net/fs/secrets/compute are NEVER granted to a foreign .md — that requires local re-sealing.${C.x}`,
    ] };
  }

  if (sub === 'list') {
    try { assertStepAllowed(caps, { action: 'skill.read' }); }
    catch (e) { return { code: 1, lines: [`${C.r}${e.message}${C.x}`] }; }
    let items;
    try { items = store.list(); } catch (e) { return { code: 1, lines: [`${C.r}store error: ${e.message}${C.x}`] }; }
    if (!items.length) {
      return { code: 0, lines: [
        `${C.B}Imported skills${C.x} ${C.d}— none yet${C.x}`,
        `${C.d}Import one with: ${C.x}${C.g}stratos skill import <file.md>${C.x}`,
      ] };
    }
    const lines = [`${C.B}Imported skills${C.x} ${C.d}(${items.length})${C.x}`];
    for (const it of items) {
      const trust = it.sealed ? `${C.g}sealed-locally${C.x}` : `${C.y}untrusted${C.x}`;
      lines.push(`  ${C.b}${it.id}${C.x}  ${trust} ${C.d}· ${it.kind}${C.x}`);
      if (it.description) lines.push(`    ${C.d}${String(it.description).slice(0, 80)}${C.x}`);
    }
    return { code: 0, lines };
  }

  if (sub === 'import') {
    try { assertStepAllowed(caps, { action: 'skill.import' }); }
    catch (e) { return { code: 1, lines: [`${C.r}${e.message}${C.x}`] }; }
    const file = rest[1];
    if (!file) return { code: 1, lines: [`${C.r}usage: stratos skill import <file.md>${C.x}`] };
    let text;
    try { text = fs.readFileSync(path.resolve(file), 'utf8'); }
    catch (e) { return { code: 1, lines: [`${C.r}cannot read ${file}: ${e.message}${C.x}`] }; }
    let rec;
    try { rec = await importSkillMd(text, { store, source: d.skillSource || `file:${path.basename(file)}` }); }
    catch (e) { return { code: 1, lines: [`${C.r}import rejected: ${e.message}${C.x}`] }; }
    const lines = [
      `${C.g}✓ imported${C.x} ${C.b}${rec.name}${C.x}  ${C.d}→ ${rec.id}${C.x}`,
      `  ${C.d}trust    ${C.x}${rec.sealed ? C.g + 'sealed-locally' + C.x : C.y + 'UNTRUSTED' + C.x} ${C.d}(${rec.kind})${C.x}`,
      `  ${C.d}granted  ${C.x}${rec.grantedCapabilities.length ? rec.grantedCapabilities.join(', ') : C.d + 'none — inert instruction skill' + C.x}`,
    ];
    if (rec.refusedCapabilities.length) {
      lines.push(`  ${C.y}refused  ${C.x}${rec.refusedCapabilities.join(', ')} ${C.d}(deny-by-default: a foreign .md can't grant these)${C.x}`);
    }
    if (rec.provenance?.claimedAuthor) {
      lines.push(`  ${C.d}author   ${C.x}${rec.provenance.claimedAuthor} ${C.y}(claimed, unverified)${C.x}`);
    }
    return { code: 0, lines };
  }

  if (sub === 'export') {
    try { assertStepAllowed(caps, { action: 'skill.read' }); }
    catch (e) { return { code: 1, lines: [`${C.r}${e.message}${C.x}`] }; }
    const id = rest[1];
    if (!id) return { code: 1, lines: [`${C.r}usage: stratos skill export <id>${C.x}`] };
    let md;
    try { md = exportSkillMd(id, { store, originDid: d.originDid }); }
    catch (e) { return { code: 1, lines: [`${C.r}export failed: ${e.message}${C.x}`] }; }
    return { code: 0, lines: md.split('\n') };
  }

  return { code: 1, lines: [`${C.r}Unknown skill subcommand: ${sub}${C.x}`, `${C.d}Try: import · export · list${C.x}`] };
}

// ── workspace / task / capture / trace / eval (operating-core) ───────────────────────────────────
const WORKSPACE_CAPS = parseCapabilities({ capabilities: { actions: ['workspace.write', 'context.capture', 'trace.write', 'eval.write'] } });

function fmtTree(node, prefix = '', isLast = true, lines = []) {
  const branch = prefix ? (isLast ? '└─ ' : '├─ ') : '';
  const tag = node.type === 'task' ? `${C.g} [task]${C.x}` : node.type === 'workspace' ? `${C.d} [workspace]${C.x}` : '';
  lines.push(`${C.d}${prefix}${C.x}${branch}${C.b}${node.name}${C.x}${tag}`);
  const next = prefix + (isLast ? '   ' : `${C.d}│${C.x}  `);
  node.children.forEach((c, i) => fmtTree(c, next, i === node.children.length - 1, lines));
  return lines;
}

function cmdWorkspace(rest, d = {}) {
  const sub = (rest[0] || 'help').toLowerCase();
  const wt = d.workspaceTree || workspaceTree;
  const root = d.workspacesRoot;

  if (sub === 'help' || sub === '-h' || sub === '--help') {
    return { code: 0, lines: [
      `${C.B}stratos workspace${C.x} ${C.d}— the files-first operational unit (Workspace > Project > Workflow > Task > Subtask)${C.x}`,
      `  ${C.g}create${C.x} <name>   Create (or resolve) a workspace`,
      `  ${C.g}tree${C.x} <name>     Print the workspace tree (tasks scaffold instructions.md · tools.json · data/ · memory/ · outputs/ · traces/ · evals/ · skills/)`,
      '',
      `  ${C.d}The durable asset is your living operational map — files on disk, framework-agnostic.${C.x}`,
    ] };
  }

  const caps = d.workspaceCaps || WORKSPACE_CAPS;

  if (sub === 'create') {
    try { assertStepAllowed(caps, { action: 'workspace.write' }); }
    catch (e) { return { code: 1, lines: [`${C.r}${e.message}${C.x}`] }; }
    const name = rest[1];
    if (!name) return { code: 1, lines: [`${C.r}usage: stratos workspace create <name>${C.x}`] };
    let r;
    try { r = wt.createWorkspace(name, root ? { root } : {}); }
    catch (e) { return { code: 1, lines: [`${C.r}${e.message}${C.x}`] }; }
    return { code: 0, lines: [
      `${r.created ? C.g + '✓ created workspace' : C.d + '• workspace exists'}${C.x} ${C.b}${r.workspace}${C.x}`,
      `  ${C.d}${r.path}${C.x}`,
    ] };
  }

  if (sub === 'tree') {
    try { assertStepAllowed(caps, { action: 'workspace.write' }); }
    catch (e) { return { code: 1, lines: [`${C.r}${e.message}${C.x}`] }; }
    const name = rest[1];
    if (!name) {
      let list;
      try { list = wt.listWorkspaces(root ? { root } : {}); }
      catch (e) { return { code: 1, lines: [`${C.r}${e.message}${C.x}`] }; }
      if (!list.length) return { code: 0, lines: [`${C.y}no workspaces yet${C.x} ${C.d}— create one: stratos workspace create <name>${C.x}`] };
      return { code: 0, lines: [`${C.B}Workspaces${C.x} ${C.d}(${list.length})${C.x}`, ...list.map((w) => `  ${C.b}${w}${C.x}`)] };
    }
    let tree;
    try { tree = wt.listTree(name, root ? { root } : {}); }
    catch (e) { return { code: 1, lines: [`${C.r}${e.message}${C.x}`] }; }
    if (!tree) return { code: 1, lines: [`${C.r}no workspace "${name}"${C.x} ${C.d}— create it: stratos workspace create ${name}${C.x}`] };
    return { code: 0, lines: [`${C.B}stratos workspace tree${C.x}`, ...fmtTree(tree)] };
  }

  return { code: 1, lines: [`${C.r}Unknown workspace subcommand: ${sub}${C.x}`, `${C.d}Try: create · tree · help${C.x}`] };
}

function cmdTask(rest, d = {}) {
  const sub = (rest[0] || 'help').toLowerCase();
  const wt = d.workspaceTree || workspaceTree;
  const root = d.workspacesRoot;

  if (sub === 'help' || sub === '-h' || sub === '--help' || !sub) {
    return { code: 0, lines: [
      `${C.B}stratos task${C.x} ${C.d}— the unit of work (scaffolds the 8 canonical entries)${C.x}`,
      `  ${C.g}create${C.x} <ws/proj/wf/task>   Create a task (and any missing parents)`,
      '',
      `  ${C.d}A task folder holds: instructions.md · tools.json · data/ · memory/ · outputs/ · traces/ · evals/ · skills/${C.x}`,
    ] };
  }

  if (sub === 'create') {
    const caps = d.workspaceCaps || WORKSPACE_CAPS;
    try { assertStepAllowed(caps, { action: 'workspace.write' }); }
    catch (e) { return { code: 1, lines: [`${C.r}${e.message}${C.x}`] }; }
    const p = rest[1];
    if (!p) return { code: 1, lines: [`${C.r}usage: stratos task create <workspace/project/workflow/task>${C.x}`] };
    const parts = p.split('/').map((s) => s.trim()).filter(Boolean);
    if (parts.length !== 4) return { code: 1, lines: [`${C.r}task path must be "workspace/project/workflow/task" (4 segments)${C.x}`] };
    let r;
    try { r = wt.createTask(parts[0], parts[1], parts[2], parts[3], root ? { root } : {}); }
    catch (e) { return { code: 1, lines: [`${C.r}${e.message}${C.x}`] }; }
    return { code: 0, lines: [
      `${r.created ? C.g + '✓ created task' : C.d + '• task exists'}${C.x} ${C.b}${parts.join(' / ')}${C.x}`,
      `  ${C.d}${r.path}${C.x}`,
      `  ${C.g}scaffolded${C.x} ${C.d}${r.scaffolded.join(' · ')}${C.x}`,
    ] };
  }

  return { code: 1, lines: [`${C.r}Unknown task subcommand: ${sub}${C.x}`, `${C.d}Try: create · help${C.x}`] };
}

function cmdCapture(rest, d = {}) {
  const cap = d.captureFn || captureEvent;
  const root = d.workspacesRoot;
  if (!rest.length || rest[0] === 'help' || rest[0] === '-h' || rest[0] === '--help') {
    return { code: rest.length ? 0 : 1, lines: [
      `${C.B}stratos capture${C.x} ${C.d}— capture an event into the operational map (Capture → Classify → Store)${C.x}`,
      `  ${C.g}stratos capture <ws/proj/wf/task> "<text>"${C.x} ${C.d}[--source chat|file|repo|terminal|browser|api|mcp] [--intent "<intent>"]${C.x}`,
      '',
      `  ${C.d}Deterministic: rule-based classify, no LLM/network. Raw → data/, record → memory/, line → session.log.${C.x}`,
    ] };
  }
  const caps = d.workspaceCaps || WORKSPACE_CAPS;
  try { assertStepAllowed(caps, { action: 'context.capture' }); }
  catch (e) { return { code: 1, lines: [`${C.r}${e.message}${C.x}`] }; }

  const taskPath = rest[0];
  const si = rest.indexOf('--source');
  const ii = rest.indexOf('--intent');
  const source = si >= 0 ? rest[si + 1] : 'terminal';
  const userIntent = ii >= 0 ? rest[ii + 1] : '';
  const text = rest.slice(1).filter((a, i) => {
    const idx = i + 1;
    if (a.startsWith('--')) return false;
    if (si >= 0 && idx === si + 1) return false;
    if (ii >= 0 && idx === ii + 1) return false;
    return true;
  }).join(' ').trim();
  if (!text) return { code: 1, lines: [`${C.r}usage: stratos capture <ws/proj/wf/task> "<text>"${C.x}`] };

  let rec;
  try { rec = cap({ task: taskPath, source, raw: text, user_intent: userIntent }, root ? { root } : {}); }
  catch (e) { return { code: 1, lines: [`${C.r}capture failed: ${e.message}${C.x}`] }; }
  return { code: 0, lines: [
    `${C.g}✓ captured${C.x} ${C.b}${rec.id}${C.x} ${C.d}· ${rec.source}/${rec.classification.intent}${C.x}`,
    `  ${C.d}raw    ${C.x}${rec._paths.raw}`,
    `  ${C.d}record ${C.x}${rec._paths.record}`,
    `  ${C.d}log    ${C.x}${rec._paths.sessionLog}`,
  ] };
}

function cmdTrace(rest, d = {}) {
  const root = d.workspacesRoot;
  if (!rest.length || rest[0] === 'help' || rest[0] === '-h' || rest[0] === '--help') {
    return { code: rest.length ? 0 : 1, lines: [
      `${C.B}stratos trace${C.x} ${C.d}— exercise the trace engine (start → steps → end, with a signed receipt spine)${C.x}`,
      `  ${C.g}stratos trace <ws/proj/wf/task>${C.x}`,
      '',
      `  ${C.d}Writes traces/{task-id}.json + a PQC-signed, hash-chained capability-receipt (the tamper-evident spine).${C.x}`,
    ] };
  }
  const caps = d.workspaceCaps || WORKSPACE_CAPS;
  try { assertStepAllowed(caps, { action: 'trace.write' }); }
  catch (e) { return { code: 1, lines: [`${C.r}${e.message}${C.x}`] }; }

  const taskPath = rest[0];
  const start = d.startTrace || startTrace;
  const step = d.recordStep || recordStep;
  const end = d.endTrace || endTrace;
  // Persistent node identity: load (or create) the node keypair so a SEPARATE
  // `stratos eval` process can verify this receipt with the public key alone.
  // Tests still inject d.traceKeyPair to stay hermetic (no on-disk keys).
  const keyPair = d.traceKeyPair || loadOrCreateNodeKeys();
  const nodeId = originId(keyPair.publicKey);

  let h, res;
  try {
    const wt = d.workspaceTree || workspaceTree;
    const tnode = wt.resolveTask(taskPath, root ? { root } : {});
    const taskId = tnode.subtask || tnode.task;
    // Persist the receipt beside the trace so `stratos eval` (a separate run) can
    // load + verify it. Fresh per trace — the trace is the final record (overwrite).
    const receiptFile = path.join(tnode.dirs.traces, `${taskId}.receipt.jsonl`);
    if (!d.traceReceiptLog) { try { fs.rmSync(receiptFile, { force: true }); } catch {} }

    h = start({ task: taskPath, model_used: d.traceModel || 'gemma2:2b', model_class: 'openweight', root, now: d.traceNow });
    step(h, { kind: 'plan', summary: 'plan the task', who: nodeId, model: 'gemma2:2b', permission: 'plan' });
    step(h, { kind: 'io', summary: 'write an output', who: nodeId, model: 'gemma2:2b', permission: 'fs.write', input: taskPath, output: 'done', cost_units: 1 });
    const log = d.traceReceiptLog || new (d.ReceiptLog || ReceiptLog)({
      path: receiptFile,
      signer: makeReceiptSigner(keyPair.privateKey),
      verifier: makeReceiptVerifier(keyPair.publicKey),
      nodeId, now: d.traceNow,
    });
    res = end(h, { result: 'ok', outputs: ['done'], receiptLog: log, actor_id: nodeId, now: d.traceNow });
    const v = res.receipt ? log.verify({ requireSig: true }) : { ok: null };
    return { code: 0, lines: [
      `${C.g}✓ trace written${C.x} ${C.d}${res.file}${C.x}`,
      `  ${C.d}steps   ${C.x}${res.trace.steps.length} · result ${res.trace.result}`,
      `  ${C.d}node    ${C.x}${didShort(nodeId)}`,
      res.receipt
        ? `  ${C.d}receipt ${C.x}${shortHash(res.receipt.hash)} ${v.ok === true ? C.g + '✓ verified (public key only)' + C.x : C.r + '✗ verify failed' + C.x}`
        : `  ${C.y}no receipt minted${C.x}`,
    ] };
  } catch (e) { return { code: 1, lines: [`${C.r}trace failed: ${e.message}${C.x}`] }; }
}

function nodeKeysPath(arg) {
  if (arg) return path.resolve(arg);
  if (process.env.STRATOS_NODE_KEYS) return process.env.STRATOS_NODE_KEYS;
  const cands = [path.join(_ROOT, '.stratos-profile', 'node-keys.json'), path.join(_ROOT, 'node-keys.json')];
  return cands.find((p) => fs.existsSync(p)) || cands[0];
}

function loadNodePublicBundle(kf) {
  if (!kf || !fs.existsSync(kf)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(kf, 'utf8'));
    return Object.fromEntries(Object.entries(raw.publicKey).map(([k, v]) => [k, Buffer.from(v, 'base64')]));
  } catch { return null; }
}

/**
 * Load the persistent node keypair from disk, creating + saving it on first use.
 * This is what makes the trace→receipt→eval loop work ACROSS processes: `trace`
 * signs with a stable key, and `eval` (a later, separate run) verifies the
 * receipt with the matching PUBLIC key via loadNodePublicBundle(nodeKeysPath()).
 * Keys serialize as base64 DER bundles — the exact shape loadNodePublicBundle
 * expects. The private key file is written 0600 (best effort).
 */
function loadOrCreateNodeKeys(kf = nodeKeysPath()) {
  const toBundle = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Buffer.from(v, 'base64')]));
  if (fs.existsSync(kf)) {
    try {
      const raw = JSON.parse(fs.readFileSync(kf, 'utf8'));
      if (raw && raw.publicKey && raw.privateKey) {
        return { publicKey: toBundle(raw.publicKey), privateKey: toBundle(raw.privateKey) };
      }
    } catch { /* corrupt → regenerate below */ }
  }
  const kp = generateHybridKeyPair();
  const ser = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Buffer.from(v).toString('base64')]));
  fs.mkdirSync(path.dirname(kf), { recursive: true });
  fs.writeFileSync(kf, JSON.stringify({ publicKey: ser(kp.publicKey), privateKey: ser(kp.privateKey) }, null, 2) + '\n');
  try { fs.chmodSync(kf, 0o600); } catch { /* non-posix */ }
  return kp;
}

function cmdEval(rest, d = {}) {
  const root = d.workspacesRoot;
  if (!rest.length || rest[0] === 'help' || rest[0] === '-h' || rest[0] === '--help') {
    return { code: rest.length ? 0 : 1, lines: [
      `${C.B}stratos eval${C.x} ${C.d}— score a trace against the deterministic rubric (the trace→eval→lesson loop)${C.x}`,
      `  ${C.g}stratos eval <ws/proj/wf/task>${C.x} ${C.d}[--budget <units>]${C.x}`,
      '',
      `  ${C.d}Writes evals/{task-id}.md + .json, links eval_path back into the trace. Default rubric:${C.x}`,
      `  ${C.d}result-ok · no-error-steps · outputs-present · cost-within-budget · trace-integrity (verify-as-a-criterion).${C.x}`,
      `  ${C.d}Each failed criterion emits a candidate lesson — the seam into self-improvement.${C.x}`,
    ] };
  }
  const caps = d.workspaceCaps || WORKSPACE_CAPS;
  try { assertStepAllowed(caps, { action: 'eval.write' }); }
  catch (e) { return { code: 1, lines: [`${C.r}${e.message}${C.x}`] }; }

  const taskPath = rest[0];
  const bi = rest.indexOf('--budget');
  const budget = bi >= 0 && /^\d+(\.\d+)?$/.test(rest[bi + 1] || '') ? Number(rest[bi + 1]) : undefined;

  const evalFn = d.evaluate || evaluateTrace;
  const read = d.readTrace || readTrace;

  let wt = d.workspaceTree || workspaceTree;
  let t, trace;
  try {
    t = wt.resolveTask(taskPath, root ? { root } : {});
    const taskId = t.subtask || t.task;
    const traceFile = path.join(t.dirs.traces, `${taskId}.json`);
    if (!fs.existsSync(traceFile)) {
      return { code: 1, lines: [
        `${C.r}no trace at ${traceFile}${C.x}`,
        `${C.d}run ${C.x}${C.g}stratos trace ${taskPath}${C.x}${C.d} first — eval scores a finished trace.${C.x}`,
      ] };
    }
    trace = read(traceFile);
  } catch (e) { return { code: 1, lines: [`${C.r}eval failed: ${e.message}${C.x}`] }; }

  const pub = d.evalPublicKeyBundle || loadNodePublicBundle(nodeKeysPath());
  const verifier = pub ? makeReceiptVerifier(pub) : undefined;
  let receiptLog;
  const rp = trace.receipt_path;
  if (verifier && rp && !String(rp).startsWith('(in-memory)') && fs.existsSync(rp)) {
    try { receiptLog = new ReceiptLog({ path: rp, verifier }); } catch { receiptLog = undefined; }
  }

  let out;
  try {
    out = evalFn({ taskPath, trace, root, budget, verifier, receiptLog, now: d.evalNow });
  } catch (e) { return { code: 1, lines: [`${C.r}eval failed: ${e.message}${C.x}`] }; }

  const r = out.record;
  const lines = [
    `${r.passed ? C.g + '✓ eval PASS' : C.y + '✗ eval FAIL'}${C.x} ${C.b}${r.task_id}${C.x} ${C.d}· ${r.score}/${r.max_score} (${Math.round(r.normalized * 100)}%)${C.x}`,
    `  ${C.d}scorecard ${C.x}${out.mdFile}`,
    `  ${C.d}record    ${C.x}${out.jsonFile}`,
  ];
  for (const c of r.criteria) {
    lines.push(`  ${c.pass ? C.g + '✓' : C.r + '✗'}${C.x} ${String(c.id).padEnd(20)} ${C.d}${c.detail}${C.x}`);
  }
  if (r.lessons.length) {
    lines.push('', `${C.B}Candidate lessons${C.x} ${C.d}(seam into self-improvement)${C.x}`);
    for (const l of r.lessons) lines.push(`  ${C.y}• ${l.criterion}${C.x} ${C.d}(${l.severity}) — ${l.suggested_instruction}${C.x}`);
  }
  return { code: 0, lines };
}

// ── route (the local-default routing decision; no model is called) ───────────────────────────────
function cmdRoute(rest) {
  if (!rest.length || rest[0] === 'help' || rest[0] === '-h' || rest[0] === '--help') {
    return { code: rest.length ? 0 : 1, lines: [
      `${C.B}stratos route${C.x} ${C.d}— show the routing decision for a prompt (no model is called)${C.x}`,
      `  ${C.g}stratos route "<prompt>"${C.x} ${C.d}[--privacy] [--mesh]${C.x}`,
      '',
      `  ${C.d}Local-default. --privacy forces a local model. --mesh signals mesh availability. The decision`,
      `  is deterministic and explains WHY (difficulty + privacy + availability), never silently going cloud.${C.x}`,
    ] };
  }
  const privacy = rest.includes('--privacy');
  const mesh = rest.includes('--mesh');
  const prompt = rest.filter((a) => !a.startsWith('--')).join(' ').trim();
  if (!prompt) return { code: 1, lines: [`${C.r}usage: stratos route "<prompt>"${C.x}`] };
  let decision;
  try {
    decision = routeDecision({ prompt, private: privacy }, { meshAvailable: mesh });
  } catch (e) { return { code: 1, lines: [`${C.r}route failed: ${e.message}${C.x}`] }; }
  return { code: 0, lines: [
    `${decision.cloud ? C.y + '→ ' + decision.tier : C.g + '→ ' + decision.tier}${C.x} ${C.d}(${decision.cloud ? 'CLOUD — opt-in' : 'local / sovereign'})${C.x}`,
    `  ${C.d}difficulty ${C.x}${decision.difficulty}`,
    `  ${C.d}why        ${C.x}${decision.reason}`,
  ] };
}

// ── receipt verify (third-party verify of a self-contained bundle, public key only) ──────────────
const RECEIPT_CAPS = parseCapabilities({ capabilities: { actions: ['receipt.read'] } });

async function cmdReceipt(rest, d = {}) {
  const sub = (rest[0] || 'help').toLowerCase();
  if (sub === 'help' || sub === '-h' || sub === '--help') {
    return { code: 0, lines: [
      `${C.B}stratos receipt${C.x} ${C.d}— the signed capability-receipt proof rail${C.x}`,
      `  ${C.g}verify${C.x} <bundle.json>   Check every PQC signature + the full hash chain (OK/BROKEN + where)`,
      '',
      `  ${C.d}A bundle embeds ONLY the node's PUBLIC key, so anyone can verify it with no private key and`,
      `  no access to the originating node. Fail-closed: any broken signature or chain link is a hard FAIL.${C.x}`,
    ] };
  }
  const caps = d.receiptCaps || RECEIPT_CAPS;
  try { assertStepAllowed(caps, { action: 'receipt.read' }); }
  catch (e) { return { code: 1, lines: [`${C.r}${e.message}${C.x}`] }; }

  if (sub === 'verify') {
    const file = rest[1];
    if (!file) return { code: 1, lines: [`${C.r}usage: stratos receipt verify <bundle.json>${C.x}`] };
    let bundle;
    try { bundle = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8')); }
    catch (e) { return { code: 1, lines: [`${C.r}cannot read bundle: ${e.message}${C.x}`] }; }
    // verifyBundle reconstructs the hybrid verifier from bundle.public_key (PUBLIC key ONLY) and
    // replays the full hash chain + every PQC signature — fail-closed, no private key, no node access.
    let result;
    try { result = verifyBundle(bundle); }
    catch (e) { return { code: 1, lines: [`${C.r}verify failed: ${e.message}${C.x}`] }; }
    return {
      code: result.ok ? 0 : 1,
      lines: result.ok
        ? [`${C.g}✓ OK${C.x} ${C.d}— ${result.count} receipt(s); every signature + the full hash chain verified with the public key only.${C.x}`]
        : [`${C.r}✗ BROKEN${C.x} ${C.d}— ${result.reason || 'signature or chain failure'}${result.brokenAt != null ? ` (at index ${result.brokenAt})` : ''}${C.x}`],
    };
  }

  return { code: 1, lines: [`${C.r}Unknown receipt subcommand: ${sub}${C.x}`, `${C.d}Try: verify${C.x}`] };
}

/** The public command surface. */
export const COMMANDS = ['workspace', 'task', 'capture', 'trace', 'eval', 'skill', 'route', 'receipt', 'version', 'help'];

export async function run(argv = [], deps = {}) {
  const d = {
    version: deps.version || '1.0.0',
    // skill (SKILL.md portability)
    skillStore: deps.skillStore,
    skillCaps: deps.skillCaps,
    skillSource: deps.skillSource,
    originDid: deps.originDid,
    // receipt verify
    receiptCaps: deps.receiptCaps,
    // operating-core
    workspaceTree: deps.workspaceTree,
    workspacesRoot: deps.workspacesRoot,
    workspaceCaps: deps.workspaceCaps,
    captureFn: deps.captureFn,
    startTrace: deps.startTrace,
    recordStep: deps.recordStep,
    endTrace: deps.endTrace,
    traceKeyPair: deps.traceKeyPair,
    traceReceiptLog: deps.traceReceiptLog,
    traceModel: deps.traceModel,
    traceNow: deps.traceNow,
    ReceiptLog: deps.ReceiptLog,
    // eval
    evaluate: deps.evaluate,
    readTrace: deps.readTrace,
    evalPublicKeyBundle: deps.evalPublicKeyBundle,
    evalNow: deps.evalNow,
  };
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case 'version': case '--version': case '-v': return { code: 0, lines: [d.version] };
    case 'help': case '--help': case '-h': case undefined: return { code: 0, lines: helpText() };
    case 'skill': return cmdSkill(rest, d);
    case 'workspace': case 'ws': return cmdWorkspace(rest, d);
    case 'task': return cmdTask(rest, d);
    case 'capture': return cmdCapture(rest, d);
    case 'trace': return cmdTrace(rest, d);
    case 'eval': return cmdEval(rest, d);
    case 'route': return cmdRoute(rest);
    case 'receipt': return cmdReceipt(rest, d);
    default: return { code: 1, lines: [`${C.r}Unknown command: ${cmd}${C.x}`, '', ...helpText()] };
  }
}
