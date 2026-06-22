// test-routing-honesty-adapter-override.mjs — ISSUE #1, NEGATIVE regression coverage for the
// SILENT adapter-layer downgrade that the existing honesty suite misses.
//
// The existing tests only exercise drops the ROUTER itself names (privacy). But the router can
// AUTHORIZE cloud for an explicit cloud/frontier model and then the ADAPTER can still serve a
// NON-frontier provider — because a budget cap stripped frontier, because capability/cost/class
// precedence preferred a cheaper local, or because no frontier provider was offered at all. Before
// this fix `override` was copied straight from the router decision, so that downgrade was SILENT
// (override === null) even though what was served diverged from what was explicitly asked for.
//
// Each test below asserts the drop is DISCLOSED: a non-null, explanatory override on BOTH the result
// and the receipt, with an honest served-cloud:false. Every one of these FAILS if the downgrade is
// silent (override left null) — which is exactly the regression issue #1 is about.
//
// Hermetic: injected fake providers, no network (each provider.call() is a local stub).
import assert from 'node:assert';
import { selectAndComplete } from './src/routing/model-adapter.js';

let pass = 0;
const ok = async (name, fn) => { await fn(); console.log(`  ✓ ${name}`); pass++; };

console.log('routing honesty (issue #1) — adapter-layer frontier downgrade is DISCLOSED, never silent\n');

// fake provider: records calls, no network. Mirrors the other honesty/adapter suites.
const mk = (id, kind, opts = {}) => {
  const p = {
    id, kind, calls: 0,
    capability: opts.capability, costClass: opts.costClass, costHint: opts.costHint,
    async call(req) {
      p.calls++;
      return { ok: true, text: `${id}:${(req.prompt || '').slice(0, 8)}`, served: id };
    },
  };
  return p;
};

// ── NEGATIVE 1 — a BUDGET cap forces an explicit cloud model away from frontier → disclosed ────────
await ok('explicit cloud model dropped by a BUDGET cap surfaces a non-null override (not silent)', async () => {
  const frontier = mk('openai', 'frontier', { capability: 5 });
  const local = mk('local-gemma', 'openweight', { capability: 3, costClass: 'local' });
  // router AUTHORIZES cloud (explicit cloud model, not private) — but a $0-only budget strips frontier.
  const out = await selectAndComplete({
    task: { prompt: 'architect a system', model: 'gpt-5' }, classHint: 'reasoning',
    providers: [frontier, local], ctx: { hasFrontierKey: true }, budget: { maxCostClass: 'local' },
  });
  assert.strictEqual(out.kind, 'openweight', 'budget forced a non-frontier provider to serve');
  assert.strictEqual(out.requestedModel, 'gpt-5', 'the requested cloud model is still recorded');
  assert.ok(typeof out.override === 'string' && out.override.length > 0,
    'a cloud model served by a non-frontier provider MUST carry an override — a null override is the silent bug');
  assert.strictEqual(out.override, 'budget', 'the override names WHY the frontier intent was dropped');
  assert.strictEqual(out.receipt.override, out.override, 'the receipt carries the SAME final override');
  assert.strictEqual(out.receipt.cloud, false, 'served local → the receipt must honestly say cloud:false');
  assert.strictEqual(out.cloud, false);
  assert.strictEqual(frontier.calls, 0, 'the stripped frontier provider was never called');
});

// ── NEGATIVE 2 — class/cost PRECEDENCE drops an explicit cloud model to local → disclosed ──────────
await ok('explicit cloud model dropped by class/cost PRECEDENCE surfaces a non-null override (not silent)', async () => {
  const frontier = mk('openai', 'frontier', { capability: 5 });
  const local = mk('local-gemma', 'openweight', { capability: 3, costClass: 'local' });
  // router AUTHORIZES cloud (explicit cloud model) but the class is extraction → $0 local is adequate
  // and cheaper, so precedence picks local. The requested frontier intent was dropped HERE.
  const out = await selectAndComplete({
    task: { prompt: 'extract the dates from this text', model: 'gpt-5' }, classHint: 'extraction',
    providers: [frontier, local], ctx: { hasFrontierKey: true },
  });
  assert.strictEqual(out.kind, 'openweight', 'precedence chose the cheaper local over the requested frontier');
  assert.ok(typeof out.override === 'string' && out.override.length > 0,
    'a cloud model silently served by local is the regression — the override MUST be named');
  assert.strictEqual(out.override, 'precedence', 'the override names the adapter-layer precedence drop');
  assert.strictEqual(out.receipt.override, 'precedence');
  assert.strictEqual(out.receipt.served.provider, 'local-gemma', 'the actual server is disclosed');
  assert.strictEqual(out.receipt.cloud, false);
  assert.strictEqual(frontier.calls, 0);
});

// ── NEGATIVE 3 — explicit cloud model with NO frontier provider offered → disclosed ───────────────
await ok('explicit cloud model with no frontier provider available surfaces a non-null override', async () => {
  const local = mk('local-gemma', 'openweight', { capability: 3, costClass: 'local' });
  const out = await selectAndComplete({
    task: { prompt: 'architect a system', model: 'claude-opus' }, classHint: 'reasoning',
    providers: [local], ctx: { hasFrontierKey: true },
  });
  assert.strictEqual(out.kind, 'openweight');
  assert.ok(typeof out.override === 'string' && out.override.length > 0,
    'a cloud request that no frontier provider can serve must still disclose the drop');
  assert.strictEqual(out.override, 'unavailable', 'the override names the missing-frontier drop');
  assert.strictEqual(out.receipt.override, 'unavailable');
  assert.strictEqual(out.receipt.cloud, false);
});

// ── POSITIVE CONTROL — an HONORED cloud choice still carries NO override (no over-firing) ──────────
await ok('an honored cloud choice (frontier actually serves) carries NO override', async () => {
  const frontier = mk('anthropic', 'frontier', { capability: 5 });
  const local = mk('local-gemma', 'openweight', { capability: 3, costClass: 'local' });
  const out = await selectAndComplete({
    task: { prompt: 'architect a system', model: 'claude-opus' }, classHint: 'reasoning',
    providers: [local, frontier], ctx: { hasFrontierKey: true },
  });
  assert.strictEqual(out.kind, 'frontier', 'the explicit cloud model was honored by a frontier provider');
  assert.strictEqual(out.provider, 'anthropic');
  assert.strictEqual(out.override, null, 'an honored choice is NOT an override — no false positive');
  assert.strictEqual(out.receipt.override, null);
  assert.strictEqual(out.receipt.cloud, true);
});

console.log(`\n✅ ${pass}/${pass} adapter-override honesty tests passed — every frontier downgrade is disclosed, no silent swap.`);
