/**
 * test-doctor.mjs — `stratos doctor` (Master Build Phase 1.1, the unshipped half the
 * quickstart verification measured: "Unknown command: doctor" on published 1.1.0).
 *
 * Contract: READ-ONLY (reports + remedies, never fixes, never writes), deterministic with
 * injected deps, exit 0 unless something FAILS (warnings are honest states, not failures).
 * Hermetic: temp profiles, injected fetch/env/version — no network, no real gateway.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { run } from './src/cli/stratos-cli.js';
import { generateHybridKeyPair } from './src/security/quantum-crypto.js';
import { ReceiptLog, makeReceiptSigner, createReceipt } from './src/ledger/capability-receipt.js';
import { originId } from './src/memory/skill-seal.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
let pass = 0;
const ok = (name, fn) => Promise.resolve().then(fn).then(() => { console.log(`  ✓ ${name}`); pass++; });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-'));
const e64 = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Buffer.from(v).toString('base64')]));

console.log('doctor — read-only node health: runtime, identity, workspaces, receipts, gateway\n');

await ok('fresh node: identity FAILS with "stratos init" remedy; gateway WARNS with the verified env example; exit 1', async () => {
  const dir = tmp();
  const r = await run(['doctor'], { keysFile: path.join(dir, 'node-keys.json'), workspacesRoot: path.join(dir, 'workspaces'), env: {} });
  assert.strictEqual(r.code, 1, 'a node with no identity has a failure to fix');
  const byName = Object.fromEntries(r.checks.map((c) => [c.name, c]));
  assert.strictEqual(byName['node identity'].status, 'fail');
  assert.match(byName['node identity'].remedy, /stratos init/);
  assert.strictEqual(byName['model gateway'].status, 'warn', 'an unset gateway is a warning, not a failure — sovereign steps still work');
  assert.match(byName['model gateway'].remedy, /STRATOS_GATEWAY_URL=/, 'remedy carries the copy-pasteable env form');
  assert.match(byName['model gateway'].remedy, /--model/, 'remedy carries the --model flag the quickstart verification proved necessary');
  assert.strictEqual(byName.receipts.status, 'warn', 'no chain yet is a state, not a failure');
  assert.deepStrictEqual(fs.readdirSync(dir), [], 'doctor wrote NOTHING (read-only)');
});

await ok('healthy node: identity ok, verified chain ok, reachable gateway ok; exit 0', async () => {
  const dir = tmp();
  const kf = path.join(dir, 'node-keys.json');
  const kp = generateHybridKeyPair();
  fs.writeFileSync(kf, JSON.stringify({ publicKey: e64(kp.publicKey), privateKey: e64(kp.privateKey) }));
  fs.mkdirSync(path.join(dir, 'workspaces', 'local'), { recursive: true });
  const rf = path.join(dir, 'live-receipts.jsonl');
  const log = new ReceiptLog({ path: rf, signer: makeReceiptSigner(kp.privateKey), nodeId: originId(kp.publicKey) });
  log.append(createReceipt({ actor_id: originId(kp.publicKey), action: 'inference', ref: 'm', cost_units: 1, node_id: originId(kp.publicKey) }));
  const fakeFetch = async () => ({ status: 405 }); // ANY HTTP answer = something is listening
  const r = await run(['doctor'], {
    keysFile: kf, workspacesRoot: path.join(dir, 'workspaces'), receiptsFile: rf,
    env: { STRATOS_GATEWAY_URL: 'http://127.0.0.1:9/v1/chat/completions' }, fetch: fakeFetch,
  });
  assert.strictEqual(r.code, 0, JSON.stringify(r.checks));
  const byName = Object.fromEntries(r.checks.map((c) => [c.name, c]));
  assert.strictEqual(byName['node identity'].status, 'ok');
  assert.strictEqual(byName.receipts.status, 'ok');
  assert.match(byName.receipts.detail, /1 receipt\(s\), chain verifies/);
  assert.strictEqual(byName['model gateway'].status, 'ok');
  assert.match(byName['model gateway'].detail, /HTTP 405/, 'reports what answered, honestly');
});

await ok('a TAMPERED chain FAILS doctor (tamper-evidence surfaces, fail-closed); unreachable gateway FAILS with a remedy', async () => {
  const dir = tmp();
  const kf = path.join(dir, 'node-keys.json');
  const kp = generateHybridKeyPair();
  fs.writeFileSync(kf, JSON.stringify({ publicKey: e64(kp.publicKey), privateKey: e64(kp.privateKey) }));
  const rf = path.join(dir, 'live-receipts.jsonl');
  const log = new ReceiptLog({ path: rf, signer: makeReceiptSigner(kp.privateKey), nodeId: originId(kp.publicKey) });
  log.append(createReceipt({ actor_id: originId(kp.publicKey), action: 'inference', ref: 'm', cost_units: 1, node_id: originId(kp.publicKey) }));
  const t = JSON.parse(fs.readFileSync(rf, 'utf8').trim()); t.cost_units = 9999;
  fs.writeFileSync(rf, JSON.stringify(t) + '\n');
  const failFetch = async () => { const err = new Error('connect ECONNREFUSED'); throw err; };
  const r = await run(['doctor'], {
    keysFile: kf, workspacesRoot: path.join(dir, 'nope'), receiptsFile: rf,
    env: { STRATOS_GATEWAY_URL: 'http://127.0.0.1:9/v1/chat/completions' }, fetch: failFetch,
  });
  assert.strictEqual(r.code, 1);
  const byName = Object.fromEntries(r.checks.map((c) => [c.name, c]));
  assert.strictEqual(byName.receipts.status, 'fail');
  assert.match(byName.receipts.detail, /BROKEN/);
  assert.match(byName.receipts.remedy, /tamper-evidence/);
  assert.strictEqual(byName['model gateway'].status, 'fail');
  assert.match(byName['model gateway'].remedy, /Ollama|model server/i);
});

await ok('the REAL binary answers `stratos doctor` (no more "Unknown command")', () => {
  const r = spawnSync(process.execPath, [path.join(HERE, 'bin', 'stratos.js'), 'doctor', 'help'], { encoding: 'utf8', timeout: 30000 });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /stratos doctor/, 'help text present');
  assert.match(r.stdout, /read-only/, 'states the no-fix contract');
});

assert.strictEqual(pass, 4, `expected all 4 tests, got ${pass}`);
console.log(`\n✅ ${pass}/4 doctor tests passed — reports honestly, fixes nothing.`);
