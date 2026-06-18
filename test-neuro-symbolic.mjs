/**
 * test-neuro-symbolic.mjs — the System-2 runtime, in the product test suite (run-tests.mjs picks it up).
 * Runs each module's hermetic selftest, then an INTEGRATION test wiring runtime.step() to the shapes of
 * the real StratosAgent organs (policy=capability-gate, record=capability-receipt, execute=model-router)
 * via stubs that match their contracts — proving the runtime composes with the product's own System 2.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRuntime } from './src/neuro-symbolic/runtime.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.error('  ✗', m); } };

console.log('neuro-symbolic — module selftests\n');
for (const m of ['fsm', 'workflow-schema', 'state-projector', 'graph-query', 'runtime']) {
  try { execFileSync('node', [path.join(here, 'src/neuro-symbolic', `${m}.mjs`), 'selftest'], { stdio: 'pipe' }); ok(true, `${m} selftest green`); }
  catch (e) { ok(false, `${m} selftest FAILED: ${e.message}`); }
}

console.log('\nneuro-symbolic — integration with product-organ shapes\n');
const fsmSpec = {
  initial: 'idle', states: ['idle', 'running', 'done'], terminal: ['done'],
  transitions: [{ from: 'idle', action: 'run', to: 'running' }, { from: 'running', action: 'finish', to: 'done' }],
};
// stub organs matching the real contracts:
const denials = [];
const policy = (action) => (action === 'run' || action === 'finish' ? { ok: true } : { ok: false, reason: 'capability-gate: deny-by-default' }) // ~ capability-gate
  ?? denials.push(action);
const ledger = [];
const record = (ev) => { ledger.push(ev); };                                   // ~ capability-receipt append
const routed = [];
const execute = async (wf, ctx) => { routed.push(ctx.model || 'local'); return { via: ctx.model || 'local' }; }; // ~ model-router (multi-model)

const r = await (async () => {
  const rt = createRuntime({ fsmSpec, reduce: (m, e) => (e.type === 'step' ? { ...m, steps: [...m.steps, e.action] } : m), initialModel: { steps: [] }, allowedActions: ['run', 'finish'], policy, record, execute });
  const a = await rt.step({ action: 'run', ctx: { model: 'claude-opus-4-8' } });
  const b = await rt.step({ action: 'finish', ctx: { model: 'local-gemma' } });
  const denied = await rt.step({ action: 'rm-rf' });
  return { a, b, denied, state: rt.state(), ledger, routed };
})();

ok(r.a.ok && r.b.ok && r.state.fsmState === 'done', 'runtime drives the FSM to done through the real-organ contracts');
ok(r.denied.ok === false, 'an action the FSM/policy reject is blocked');
ok(r.ledger.some((e) => e.type === 'intent') && r.ledger.some((e) => e.type === 'step'), 'write-ahead: intent + step events recorded to the ledger');
ok(JSON.stringify(r.routed) === '["claude-opus-4-8","local-gemma"]', 'multi-model: each step routes to the model the ctx selects');

console.log(`\n${fail ? '✖' : '✓'} neuro-symbolic: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
