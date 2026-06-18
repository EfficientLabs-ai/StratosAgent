#!/usr/bin/env node
/**
 * fsm.mjs — the DETERMINISTIC STATE LAYER of the neuro-symbolic runtime (System 2).
 *
 * The LLM (System 1) PROPOSES an action; this FSM DISPOSES — it decides, deterministically and at
 * zero model cost, whether a proposed transition is legal given the current state, a per-transition
 * guard, and global invariants. State lives HERE (and in the signed event log), never in chat history.
 *
 * Pure + injectable + never throws (a malformed proposal returns {ok:false, reason}, never an
 * exception the LLM has to reason about). Mirrors the command-center skill idiom: a small loadable
 * interface + a hermetic selftest() + a CLI runner.
 *
 *   import { createFSM } from './fsm.mjs'
 *   const fsm = createFSM(spec); const r = fsm.validate(state, action, ctx)
 *   node fsm.mjs selftest
 */

/**
 * @param {object} spec
 *   spec.initial      : string                         the start state
 *   spec.states       : string[]                       the closed set of legal states
 *   spec.transitions  : {from, action, to, guard?}[]   guard(ctx) -> true | "reason"
 *   spec.invariants   : ((ctx, transition) -> true|"reason")[]   must hold for EVERY accepted transition
 *   spec.terminal     : string[]   (optional) states from which no transition is legal
 */
export function createFSM(spec = {}) {
  const states = Array.isArray(spec.states) ? spec.states : [];
  const transitions = Array.isArray(spec.transitions) ? spec.transitions : [];
  const invariants = Array.isArray(spec.invariants) ? spec.invariants : [];
  const terminal = new Set(Array.isArray(spec.terminal) ? spec.terminal : []);
  if (!states.length) throw new Error('createFSM requires a non-empty states[]');
  if (spec.initial && !states.includes(spec.initial)) throw new Error('initial state is not in states[]');

  /**
   * Validate a proposed transition. NEVER throws. Returns one of:
   *   { ok:true, from, action, to }                         legal — caller may apply it
   *   { ok:false, reason }                                  rejected deterministically (give `reason` back to the LLM)
   */
  function validate(state, action, ctx = {}) {
    if (typeof state !== 'string' || !states.includes(state)) return { ok: false, reason: `unknown state "${state}"` };
    if (typeof action !== 'string' || !action) return { ok: false, reason: 'action must be a non-empty string' };
    if (terminal.has(state)) return { ok: false, reason: `state "${state}" is terminal — no transition is legal` };
    const t = transitions.find((x) => x.from === state && x.action === action);
    if (!t) return { ok: false, reason: `illegal transition: action "${action}" is not allowed from "${state}"` };
    if (!states.includes(t.to)) return { ok: false, reason: `transition target "${t.to}" is not a declared state (spec bug)` };
    if (typeof t.guard === 'function') {
      let g; try { g = t.guard(ctx); } catch (e) { return { ok: false, reason: `guard threw: ${e.message}` }; }
      if (g !== true) return { ok: false, reason: `guard failed: ${typeof g === 'string' ? g : 'guard returned non-true'}` };
    }
    for (const inv of invariants) {
      let r; try { r = inv(ctx, t); } catch (e) { return { ok: false, reason: `invariant threw: ${e.message}` }; }
      if (r !== true) return { ok: false, reason: `invariant violated: ${typeof r === 'string' ? r : 'invariant returned non-true'}` };
    }
    return { ok: true, from: state, action, to: t.to };
  }

  /** Legal next actions from a state (for the LLM to choose among — narrows the action space). */
  function legalActions(state) {
    if (terminal.has(state)) return [];
    return transitions.filter((x) => x.from === state).map((x) => x.action);
  }

  return { validate, legalActions, states, initial: spec.initial, isTerminal: (s) => terminal.has(s) };
}

// ── hermetic selftest ──
function selftest() {
  let pass = 0, fail = 0;
  const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.error('  ✗', m); } };

  // a deploy workflow FSM with a guard + a global invariant
  const fsm = createFSM({
    initial: 'created',
    states: ['created', 'validated', 'running', 'done', 'failed'],
    terminal: ['done', 'failed'],
    transitions: [
      { from: 'created', action: 'validate', to: 'validated' },
      { from: 'validated', action: 'deploy', to: 'running', guard: (c) => c.approved === true || 'approval required to deploy' },
      { from: 'running', action: 'complete', to: 'done' },
      { from: 'running', action: 'fail', to: 'failed' },
    ],
    invariants: [
      // never allow external traffic during a migration (the brief's example)
      (c, t) => !(t.action === 'deploy' && c.migrating && c.allow_external_traffic) || 'no external traffic during a migration',
    ],
  });

  ok(fsm.validate('created', 'validate').ok === true, 'legal transition accepted (created→validated)');
  ok(fsm.validate('created', 'deploy').ok === false, 'illegal transition rejected (deploy from created)');
  ok(fsm.validate('validated', 'deploy', { approved: false }).ok === false, 'guard blocks unapproved deploy');
  ok(fsm.validate('validated', 'deploy', { approved: true }).to === 'running', 'guard passes approved deploy → running');
  ok(fsm.validate('validated', 'deploy', { approved: true, migrating: true, allow_external_traffic: true }).ok === false, 'invariant blocks external traffic during migration');
  ok(fsm.validate('done', 'complete').ok === false, 'terminal state rejects all transitions');
  ok(fsm.validate('nope', 'validate').ok === false, 'unknown state rejected (never throws)');
  ok(fsm.validate('created', 123).ok === false, 'non-string action rejected (never throws)');
  ok(JSON.stringify(fsm.legalActions('running')) === JSON.stringify(['complete', 'fail']), 'legalActions narrows the action space');
  ok(fsm.validate('validated', 'deploy', { approved: true, guard: () => { throw new Error('x'); } }).ok === true, 'caller ctx cannot crash validate');

  console.log(`\n${fail ? '✖' : '✓'} fsm: ${pass} passed, ${fail} failed`);
  return fail === 0;
}

import { fileURLToPath } from 'node:url';
import path from 'node:path';
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv[2] === 'selftest') process.exit(selftest() ? 0 : 1);
  else { console.error('usage: fsm.mjs selftest'); process.exit(2); }
}
