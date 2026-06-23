/**
 * test-release-provenance.mjs — the provenance script's pure decision logic, hermetically.
 *
 * The orchestration in scripts/release-provenance.mjs shells out (git/npm/the CLI) and is meant to be
 * reproduced by a reviewer, not unit-tested here. What MUST stay correct under refactor is the pure
 * logic that decides PASS/FAIL: version comparison, the Node >=20.19.0 gate, the published-tarball
 * secret scan, and the summary roll-up. Those are tested below with zero network/filesystem/process.
 *
 * Importing the script must NOT run it (the isMain guard) — that is itself part of the contract.
 */
import assert from 'node:assert';
import {
  normalizeVersion, versionsMatch, meetsMinNode, packLeaksSecrets, summarize,
  PASS, FAIL, WARN, SKIP,
} from './scripts/release-provenance.mjs';

// normalizeVersion — strip a leading v, trim, tolerate nullish
assert.equal(normalizeVersion('v1.3.0'), '1.3.0');
assert.equal(normalizeVersion('  1.3.0 '), '1.3.0');
assert.equal(normalizeVersion(undefined), '');
assert.equal(normalizeVersion(null), '');

// versionsMatch — equal regardless of v-prefix; empty/unknown never matches (no false provenance)
assert.ok(versionsMatch('1.3.0', 'v1.3.0'), 'v-prefix should not break equality');
assert.ok(versionsMatch('v1.3.0', '1.3.0'));
assert.ok(!versionsMatch('1.3.0', '1.3.1'));
assert.ok(!versionsMatch('', ''), 'two empties must NOT count as a match');
assert.ok(!versionsMatch(undefined, '1.3.0'));

// meetsMinNode — the engines.node >=20.19.0 gate, at and around the boundary
assert.ok(meetsMinNode('v20.19.0', '20.19.0'), 'exact minimum passes');
assert.ok(meetsMinNode('v20.19.1', '20.19.0'));
assert.ok(meetsMinNode('v20.20.0', '20.19.0'));
assert.ok(meetsMinNode('v22.4.1', '20.19.0'));
assert.ok(meetsMinNode('v21.0.0', '20.19.0'));
assert.ok(!meetsMinNode('v20.18.9', '20.19.0'), 'one patch below the minor floor fails');
assert.ok(!meetsMinNode('v20.18.0', '20.19.0'));
assert.ok(!meetsMinNode('v18.20.0', '20.19.0'));

// packLeaksSecrets — a published tarball must never carry keys/.env/pem
assert.ok(packLeaksSecrets(['src/cli.js', 'README.md', 'LICENSE', 'bin/stratos.js']).ok, 'a clean file list is clean');
const k = packLeaksSecrets(['src/cli.js', '.stratos-profile/node-keys.json']);
assert.ok(!k.ok && k.offenders.length === 1 && /node-keys\.json/.test(k.offenders[0]), 'node-keys.json must be caught');
assert.ok(!packLeaksSecrets(['.env']).ok, 'a bare .env must be caught');
assert.ok(!packLeaksSecrets(['config/.env.production']).ok, '.env.production must be caught');
assert.ok(!packLeaksSecrets(['secrets/prod.pem']).ok, 'a .pem must be caught');
assert.ok(!packLeaksSecrets(['keys/signing.key']).ok, 'a .key must be caught');
assert.ok(packLeaksSecrets([]).ok, 'empty list is trivially clean');

// summarize — counts roll up; ok IFF zero FAIL (warn/skip are honest, not fatal)
const s = summarize([{ status: PASS }, { status: PASS }, { status: WARN }, { status: SKIP }]);
assert.deepEqual(s.counts, { PASS: 2, FAIL: 0, WARN: 1, SKIP: 1 });
assert.equal(s.total, 4);
assert.ok(s.ok, 'warn + skip alone must not fail provenance');
assert.ok(!summarize([{ status: PASS }, { status: FAIL }]).ok, 'any FAIL fails provenance');
assert.ok(summarize([]).ok, 'an empty check set is vacuously ok');

console.log('  ✓ release-provenance: version/node-gate/secret-scan/summary logic verified (hermetic, no net/fs/proc)');
