/**
 * test-receipt-export.mjs — EFL-004: the README "Prove it #2" flow must be reproducible.
 *
 * `exportBundle()` existed in the library but was unreachable from the CLI, so a reader following the
 * README (`receipt verify ./bundle.json`) had no way to PRODUCE bundle.json. This test exercises the
 * new `receipt export` subcommand end-to-end: seed a signed receipt log → export a public-key-embedded
 * bundle → verify it with the PUBLIC KEY ONLY → tamper one field → verify fails closed.
 *
 * Hermetic: pure crypto + filesystem, no network/Ollama/live services.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run } from './src/cli/stratos-cli.js';
import { ReceiptLog, makeReceiptSigner, makeReceiptVerifier } from './src/ledger/capability-receipt.js';
import { generateHybridKeyPair } from './src/security/quantum-crypto.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'efl004-'));
const jsonl = path.join(tmp, 'task.receipt.jsonl');
const bundle = path.join(tmp, 'bundle.json');
const tampered = path.join(tmp, 'tampered.json');
const out = (r) => (r.lines || []).join('\n').replace(/\x1b\[[0-9;]*m/g, '');

// Seed a signed 2-receipt log, exactly as a trace would produce on disk.
const kp = generateHybridKeyPair();
const log = new ReceiptLog({
  path: jsonl,
  signer: makeReceiptSigner(kp.privateKey),
  verifier: makeReceiptVerifier(kp.publicKey),
  nodeId: 'did:atmos:test',
});
log.append({ actor_id: 'did:atmos:test', action: 'inference', ref: 'gemma2:2b', cost_units: 1 });
log.append({ actor_id: 'did:atmos:test', action: 'skill-run', ref: 'skill-abc', cost_units: 0 });

// 1. export → bundle.json (the previously-unreachable step)
let r = await run(['receipt', 'export', jsonl, '--out', bundle], { traceKeyPair: kp });
assert.equal(r.code, 0, 'export should succeed: ' + out(r));
assert.ok(/exported\s+2 receipt/.test(out(r)), 'export should report 2 receipts: ' + out(r));
assert.ok(fs.existsSync(bundle), 'bundle.json should be written');
const parsed = JSON.parse(fs.readFileSync(bundle, 'utf8'));
assert.ok(parsed.public_key && !parsed.private_key, 'bundle embeds the PUBLIC key only, never the private key');

// 2. verify with the PUBLIC KEY ONLY (no keys passed to run)
r = await run(['receipt', 'verify', bundle], {});
assert.equal(r.code, 0, 'verify should pass on a clean bundle: ' + out(r));
assert.ok(/OK/.test(out(r)) && /2 receipt/.test(out(r)), 'verify should report OK, 2 receipts: ' + out(r));

// 3. tamper one field → fail closed
const b = JSON.parse(fs.readFileSync(bundle, 'utf8'));
b.receipts[0].cost_units = 999999;
fs.writeFileSync(tampered, JSON.stringify(b));
r = await run(['receipt', 'verify', tampered], {});
assert.equal(r.code, 1, 'verify must FAIL on a tampered bundle');
assert.ok(/BROKEN/.test(out(r)), 'verify should report BROKEN: ' + out(r));

// 4. stdout mode (no --out) emits the bundle JSON
r = await run(['receipt', 'export', jsonl], { traceKeyPair: kp });
assert.equal(r.code, 0, 'export to stdout should succeed');
assert.ok(/stratos\.capability-receipts/.test(out(r)), 'stdout export should emit the bundle JSON');

// 5. honest failure when the source has no receipts
r = await run(['receipt', 'export', path.join(tmp, 'nope.jsonl')], { traceKeyPair: kp });
assert.equal(r.code, 1, 'export of a non-existent/empty log should fail honestly');

fs.rmSync(tmp, { recursive: true, force: true });
console.log('  ✓ EFL-004: receipt export → verify → tamper flow reproducible (CLI export subcommand wired; public-key-only bundle)');
