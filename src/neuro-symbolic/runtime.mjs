#!/usr/bin/env node
/**
 * runtime.mjs — THE NEURO-SYMBOLIC EXECUTION LOOP (orchestration + routing). Hardened per Codex audit.
 *
 * System 1 (any LLM/provider) PROPOSES a workflow-as-data + a state transition; System 2 DISPOSES,
 * in strict order, BEFORE anything executes:
 *   0. SHAPE       — action is a non-empty string; workflow & ctx are JSON-plain DATA (no functions /
 *                    custom prototypes / __proto__ gadgets) — closes prototype-pollution + non-data input
 *   1. CODE-AS-DATA— schema/AST-validate the workflow tree                 (workflow-schema.mjs)
 *   2. STATE       — FSM legality + guards + invariants                    (fsm.mjs)
 *   3. CONSTRAINT  — deny-by-default policy gate                           (injected: capability-gate)
 *   4. WRITE-AHEAD — durably record an INTENT before executing; if the durable record fails, ABORT
 *                    with NO side-effect (exactly-once-in-effect: a dangling intent on replay marks an
 *                    in-flight step, never silently re-runs it)
 *   5. EXECUTE     — sandboxed                                            (injected: WASI executor)
 *   6. RESULT      — record the result + advance fsmState + project model only on a recorded result
 * Single-writer: concurrent step() calls are rejected (stage:'busy'), so the FSM can't double-execute.
 * Model-agnostic: `execute` is injected. Continuity: replay(log) restores exact state, order-independent
 * and idempotent, and surfaces any dangling intent for the caller to reconcile.
 */
import { createFSM } from './fsm.mjs';
import { validateWorkflow } from './workflow-schema.mjs';

/**
 * Deep check: value is JSON-plain data only. ACCESSOR-SAFE — reads via property descriptors and
 * rejects any getter/setter WITHOUT invoking it (an accessor that fires during validation is a
 * code-execution vector; Codex finding). Rejects functions, custom prototypes, and __proto__ gadgets.
 */
export function isPlainData(v, depth = 0) {
  if (depth > 64) return false;
  if (v === null) return true;
  const t = typeof v;
  if (t === 'string' || t === 'boolean') return true;
  if (t === 'number') return Number.isFinite(v);
  if (t !== 'object') return false; // function / symbol / bigint / undefined
  const proto = Object.getPrototypeOf(v);
  if (Array.isArray(v)) {
    if (proto !== Array.prototype) return false;
    for (const k of Object.getOwnPropertyNames(v)) {
      if (k === 'length') continue;
      const d = Object.getOwnPropertyDescriptor(v, k);
      if (!d) continue;                       // a hole serializes to null — fine
      if (!('value' in d)) return false;      // accessor — reject, never invoke
      if (!isPlainData(d.value, depth + 1)) return false;
    }
    return true;
  }
  if (proto !== Object.prototype && proto !== null) return false; // custom-prototype gadget
  for (const k of Object.getOwnPropertyNames(v)) {
    if (k === '__proto__') return false;
    const d = Object.getOwnPropertyDescriptor(v, k);
    if (!d || !('value' in d)) return false;  // accessor (getter/setter) — reject without invoking
    if (!isPlainData(d.value, depth + 1)) return false;
  }
  return true;
}

/** Stable order by integer seq when ALL events carry one; else preserve input order. */
function ordered(events) {
  const list = (events || []).map((e, i) => ({ e, i, s: Number.isInteger(e?.seq) ? e.seq : null }));
  if (list.every((x) => x.s !== null)) list.sort((a, b) => a.s - b.s || a.i - b.i);
  return list.map((x) => x.e);
}

export function createRuntime(deps = {}) {
  const fsm = deps.fsm || createFSM(deps.fsmSpec);
  const reduce = typeof deps.reduce === 'function' ? deps.reduce : (m) => m;
  const policy = typeof deps.policy === 'function' ? deps.policy : () => ({ ok: true });
  const execute = typeof deps.execute === 'function' ? deps.execute : async () => ({});
  const record = typeof deps.record === 'function' ? deps.record : () => {};
  const allowedActions = Array.isArray(deps.allowedActions) ? deps.allowedActions : null;

  let fsmState = deps.fsmSpec?.initial ?? fsm.initial;
  let model = deps.initialModel;
  let seq = 0;
  let busy = false;
  const log = [];

  async function step(proposal = {}) {
    if (busy) return { ok: false, stage: 'busy', reason: 'a step is already in flight (single-writer FSM)' };
    busy = true;
    try {
      const ctx = proposal.ctx || {};
      const action = proposal.transition?.action ?? proposal.action;
      // 0. SHAPE — action + data-only inputs (closes proto-pollution / non-data gadgets)
      if (typeof action !== 'string' || !action) return { ok: false, stage: 'shape', reason: 'proposal.action must be a non-empty string' };
      if (proposal.workflow !== undefined && !isPlainData(proposal.workflow)) return { ok: false, stage: 'shape', reason: 'workflow must be JSON-plain data (no functions / custom prototypes / __proto__)' };
      if (!isPlainData(ctx)) return { ok: false, stage: 'shape', reason: 'ctx must be JSON-plain data' };
      // 1. CODE-AS-DATA
      if (proposal.workflow !== undefined) {
        const v = validateWorkflow(proposal.workflow, { allowedActions });
        if (!v.ok) return { ok: false, stage: 'schema', reason: v.errors[0], errors: v.errors };
      }
      // 2. STATE
      const t = fsm.validate(fsmState, action, ctx);
      if (!t.ok) return { ok: false, stage: 'fsm', reason: t.reason, legal: fsm.legalActions(fsmState) };
      // 3. CONSTRAINT
      let pol; try { pol = await policy(action, ctx, proposal); } catch (e) { pol = { ok: false, reason: `policy threw: ${e.message}` }; }
      if (!pol || pol.ok !== true) return { ok: false, stage: 'policy', reason: pol?.reason || 'denied by policy' };
      // 4. WRITE-AHEAD — durably record the intent (AWAITED) BEFORE execute; any sink failure (sync OR
      //    async) aborts with NO side-effect.
      const intent = { seq: seq + 1, type: 'intent', action, to: t.to };
      try { await record(intent); } catch (e) { return { ok: false, stage: 'record-intent', reason: `could not durably record intent — aborted before any side-effect: ${e.message}` }; }
      seq = intent.seq; log.push(intent);
      // 5. EXECUTE
      let result;
      try { result = await execute(proposal.workflow, ctx); }
      catch (e) {
        try { const fe = { seq: seq + 1, type: 'fail', action, error: e.message }; await record(fe); seq = fe.seq; log.push(fe); } catch { /* fail-marker best-effort */ }
        return { ok: false, stage: 'execute', reason: e.message };
      }
      // 6. RESULT — must be DURABLY recorded (awaited) before state advances. If the sink fails AFTER a
      //    successful execute, do NOT advance state — the dangling intent on replay flags it to reconcile.
      const ev = { seq: seq + 1, type: 'step', action, to: t.to, result };
      try { await record(ev); } catch (e) { return { ok: false, stage: 'record-result', executed: true, reason: `executed but result not durably recorded — reconcile via the dangling intent: ${e.message}` }; }
      seq = ev.seq; log.push(ev); fsmState = t.to; model = reduce(model, ev);
      return { ok: true, fsmState, model, result };
    } finally { busy = false; }
  }

  /** Restore from an event log (order-independent, idempotent). Only 'step' events advance state.
   *  An 'intent' with no following 'step' is a dangling in-flight step → surfaced, never auto-applied. */
  function replay(events) {
    let st = deps.fsmSpec?.initial ?? fsm.initial, m = deps.initialModel, s = 0;
    const applied = new Set(), intents = new Set();
    for (const e of ordered(events)) {
      const es = Number.isInteger(e?.seq) ? e.seq : s + 1;
      if (es <= s || applied.has(es)) continue; // idempotent: never apply a seq twice
      if (e.type === 'intent') intents.add(es);
      if (e.type === 'step') { if (typeof e.to === 'string') st = e.to; m = reduce(m, e); intents.delete(es - 1); }
      applied.add(es); s = es;
    }
    const danglingIntent = [...intents].some((iSeq) => !applied.has(iSeq + 1));
    fsmState = st; model = m; seq = s; log.length = 0; log.push(...ordered(events));
    return { fsmState, model, seq, danglingIntent };
  }

  return { step, replay, log: () => [...log], state: () => ({ fsmState, model, seq }) };
}

// ── hermetic selftest: the loop, every reject stage, hardening cases, crash→replay ──
function selftest() {
  let pass = 0, fail = 0;
  const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.error('  ✗', m); } };

  const fsmSpec = {
    initial: 'created', states: ['created', 'validated', 'running', 'done', 'failed'], terminal: ['done', 'failed'],
    transitions: [
      { from: 'created', action: 'validate', to: 'validated' },
      { from: 'validated', action: 'run', to: 'running', guard: (c) => c.approved === true || 'approval required' },
      { from: 'running', action: 'complete', to: 'done' },
    ],
  };
  const reduce = (m, e) => (e.type === 'step' ? { ...m, steps: [...m.steps, e.action] } : m);
  const mk = (over = {}) => createRuntime({ fsmSpec, reduce, initialModel: { steps: [] }, allowedActions: ['validate', 'run', 'complete', 'noop'], ...over });

  return (async () => {
    const rt = mk();
    let r = await rt.step({ workflow: { type: 'tool', action: 'noop' }, action: 'validate' });
    ok(r.ok && r.fsmState === 'validated', 'step 1 passes all gates → validated');
    ok(!(await rt.step({ action: 'run', ctx: { approved: false } })).ok, 'fsm guard rejects unapproved run');
    r = await rt.step({ action: 'run', ctx: { approved: true } });
    ok(r.ok && r.fsmState === 'running', 'approved run → running');
    r = await rt.step({ action: 'complete' });
    ok(r.ok && r.fsmState === 'done' && JSON.stringify(r.model.steps) === '["validate","run","complete"]', 'completes; model projected (intents excluded)');

    // reject stages incl. the hardening cases
    const rt2 = mk();
    ok((await rt2.step({ action: '' })).stage === 'shape', 'empty action rejected at stage=shape');
    ok((await rt2.step({ workflow: { type: 'tool', action: 'noop', args: { fn: () => 1 } }, action: 'validate' })).stage === 'shape', 'workflow with a function rejected (data-only)');
    ok((await rt2.step({ workflow: JSON.parse('{"type":"tool","action":"noop","args":{"__proto__":{"x":1}}}'), action: 'validate' })).stage === 'shape', '__proto__ gadget in workflow rejected');
    ok((await rt2.step({ action: 'validate', ctx: { bad: () => 1 } })).stage === 'shape', 'non-data ctx rejected');
    ok((await rt2.step({ workflow: { type: 'tool' }, action: 'validate' })).stage === 'schema', 'malformed workflow rejected at stage=schema');
    ok((await rt2.step({ action: 'teleport' })).stage === 'fsm', 'illegal action rejected at stage=fsm');
    ok((await mk({ policy: () => ({ ok: false, reason: 'denied' }) }).step({ action: 'validate' })).stage === 'policy', 'policy gate rejects');

    // WRITE-AHEAD: intent-record failure aborts BEFORE execute (no side-effect)
    let executed = false;
    const rtWA = mk({ record: (e) => { if (e.type === 'intent') throw new Error('disk full'); }, execute: async () => { executed = true; return {}; } });
    const wa = await rtWA.step({ action: 'validate' });
    ok(wa.stage === 'record-intent' && executed === false, 'sync intent-record failure aborts before execute');
    // ASYNC durable-sink rejection on the intent must ALSO abort before execute (record is awaited)
    let exA = false;
    const rtAR = mk({ record: async (e) => { if (e.type === 'intent') throw new Error('async sink down'); }, execute: async () => { exA = true; return {}; } });
    ok((await rtAR.step({ action: 'validate' })).stage === 'record-intent' && exA === false, 'ASYNC intent-record rejection aborts before execute');
    // result-record failure AFTER a successful execute: executed but state NOT advanced
    let exR = false;
    const rtRR = mk({ record: async (e) => { if (e.type === 'step') throw new Error('result sink down'); }, execute: async () => { exR = true; return {}; } });
    const rr = await rtRR.step({ action: 'validate' });
    ok(rr.stage === 'record-result' && rr.executed === true && exR === true && rtRR.state().fsmState === 'created', 'result-record failure: executed but state NOT advanced (reconcile via dangling intent)');
    // accessor getter on ctx is rejected WITHOUT being invoked (no code-exec during validation)
    let fired = false; const ctxGetter = {}; Object.defineProperty(ctxGetter, 'x', { enumerable: true, get() { fired = true; return 1; } });
    ok((await mk().step({ action: 'validate', ctx: ctxGetter })).stage === 'shape' && fired === false, 'accessor getter rejected without firing (no code-exec during validation)');

    // execute failure recorded, no stuck loop
    const rtEx = mk({ execute: async () => { throw new Error('sandbox boom'); } });
    const ef = await rtEx.step({ action: 'validate' });
    ok(ef.stage === 'execute' && rtEx.log().some((e) => e.type === 'fail'), 'execute failure recorded as fail event');

    // reentrancy: a concurrent step is rejected (single-writer)
    const rtC = mk({ execute: () => new Promise((res) => setTimeout(() => res({}), 20)) });
    const p1 = rtC.step({ action: 'validate' });
    const p2 = await rtC.step({ action: 'validate' });
    ok(p2.stage === 'busy', 'concurrent step rejected (no double-execute)');
    await p1;

    // crash → replay: order-independent, idempotent, dangling-intent surfaced
    const rtA = mk(); await rtA.step({ action: 'validate' }); await rtA.step({ action: 'run', ctx: { approved: true } });
    const saved = rtA.log();
    const restored = mk().replay([...saved].reverse()); // give it UNSORTED
    ok(restored.fsmState === 'running' && JSON.stringify(restored.model.steps) === '["validate","run"]', 'replay restores exact state from an UNSORTED log');
    ok(JSON.stringify(mk().replay([...saved, ...saved]).model.steps) === '["validate","run"]', 'replay idempotent against a duplicated log');
    const dangling = mk().replay([{ seq: 1, type: 'intent', action: 'validate', to: 'validated' }]);
    ok(dangling.danglingIntent === true && dangling.fsmState === 'created', 'dangling intent (crash mid-execute) surfaced, NOT auto-applied');

    console.log(`\n${fail ? '✖' : '✓'} runtime: ${pass} passed, ${fail} failed`);
    return fail === 0;
  })();
}

import { fileURLToPath } from 'node:url';
import path from 'node:path';
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv[2] === 'selftest') selftest().then((o) => process.exit(o ? 0 : 1));
  else { console.error('usage: runtime.mjs selftest'); process.exit(2); }
}
