#!/usr/bin/env node
/**
 * state-projector.mjs — EVENT-LOG SNAPSHOT → REPLAY (the CONTINUITY layer). Hardened per Codex audit.
 *
 * State is projected from the append-only, hash-chained SIGNED event log, never from chat history. On a
 * crash mid-run the agent restores the last checkpoint and REPLAYS the remaining events — order-
 * independent (sorted by monotonic seq), idempotent (a seq is never applied twice, so a duplicated or
 * out-of-order log can't lose or double-apply an event), and without re-deriving from prose.
 *
 * Pure, deterministic, never throws on a well-typed reducer. EVENT = { seq:int(monotonic), type, ... }.
 *   import { project, makeCheckpoint, replayFrom } from './state-projector.mjs'
 *   node state-projector.mjs selftest
 */

/** Stable order by integer seq when ALL events carry one; else preserve input order (best-effort). */
function ordered(events) {
  const list = (events || []).map((e, i) => ({ e, i, s: Number.isInteger(e?.seq) ? e.seq : null }));
  if (list.every((x) => x.s !== null)) list.sort((a, b) => a.s - b.s || a.i - b.i);
  return list.map((x) => x.e);
}

/** Fold the log into current state. reduce(state,event)->nextState. Order-independent + exactly-once. */
export function project(events, reduce, initial) {
  if (typeof reduce !== 'function') throw new Error('project requires a reduce(state,event) function');
  let state = initial, seq = 0;
  const applied = new Set();
  for (const e of ordered(events)) {
    const es = Number.isInteger(e?.seq) ? e.seq : seq + 1;
    if (es <= seq || applied.has(es)) continue; // never apply a seq twice (dup / out-of-order)
    state = reduce(state, e); applied.add(es); seq = es;
  }
  return { state, seq };
}

/** Snapshot at the current head — the durable thing you recover from. */
export function makeCheckpoint(events, reduce, initial) {
  const { state, seq } = project(events, reduce, initial);
  return { seq, state };
}

/** Restore from a checkpoint and replay only events AFTER it. Idempotent + order-independent. */
export function replayFrom(checkpoint, events, reduce) {
  if (typeof reduce !== 'function') throw new Error('replayFrom requires a reduce(state,event) function');
  let state = checkpoint?.state, seq = Number.isInteger(checkpoint?.seq) ? checkpoint.seq : 0;
  const applied = new Set();
  for (const e of ordered(events)) {
    const es = Number.isInteger(e?.seq) ? e.seq : seq + 1;
    if (es <= seq || applied.has(es)) continue;
    state = reduce(state, e); applied.add(es); seq = es;
  }
  return { state, seq };
}

// ── hermetic selftest ──
function selftest() {
  let pass = 0, fail = 0;
  const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.error('  ✗', m); } };

  const reduce = (s, e) => (e.type === 'step.done' ? { ...s, done: [...s.done, e.id], n: s.n + 1 } : e.type === 'note' ? { ...s, last: e.text } : s);
  const initial = { done: [], n: 0, last: null };
  const log = [
    { seq: 1, type: 'step.done', id: 'a' }, { seq: 2, type: 'note', text: 'midway' },
    { seq: 3, type: 'step.done', id: 'b' }, { seq: 4, type: 'step.done', id: 'c' },
  ];

  const full = project(log, reduce, initial);
  ok(full.seq === 4 && full.state.n === 3 && JSON.stringify(full.state.done) === '["a","b","c"]', 'project folds the whole log');
  ok(project([...log].reverse(), reduce, initial).state.n === 3, 'project is ORDER-INDEPENDENT (sorts by seq) — fixes the lost-event bug');

  const cp = makeCheckpoint(log.slice(0, 2), reduce, initial);
  ok(cp.seq === 2 && cp.state.n === 1, 'checkpoint captures state at the crash point');
  const restored = replayFrom(cp, log, reduce);
  ok(JSON.stringify(restored.state) === JSON.stringify(full.state) && restored.seq === 4, 'replayFrom restores EXACTLY the full state');
  // STRONG idempotency: replay AGAIN from the already-restored head must not duplicate
  const again = replayFrom({ seq: restored.seq, state: restored.state }, log, reduce);
  ok(again.state.n === 3 && again.seq === 4, 'replay from the restored head is idempotent (no duplicated steps)');

  ok(project([...log, { seq: 3, type: 'step.done', id: 'b' }, { seq: 2, type: 'step.done', id: 'a' }], reduce, initial).state.n === 3, 'duplicate / out-of-order events dropped (exactly-once)');
  ok(replayFrom({ seq: 0, state: initial }, [...log].reverse(), reduce).state.n === 3, 'cold replay from an unsorted log restores fully');

  console.log(`\n${fail ? '✖' : '✓'} state-projector: ${pass} passed, ${fail} failed`);
  return fail === 0;
}

import { fileURLToPath } from 'node:url';
import path from 'node:path';
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv[2] === 'selftest') process.exit(selftest() ? 0 : 1);
  else { console.error('usage: state-projector.mjs selftest'); process.exit(2); }
}
