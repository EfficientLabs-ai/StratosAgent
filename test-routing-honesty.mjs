// test-routing-honesty.mjs — ISSUE #1: model-routing honesty regression coverage.
//
// These tests FAIL (red) the moment the router stops being honest about WHAT it ran. Each one is tied
// to the router/adapter's ACTUAL behavior — no stubbed-out invariants, no trivial passes. They guard
// four properties that a "free models, the proof is the value" system can never silently break:
//
//   1. An explicit model/provider choice is HONORED — and if it is ever dropped, the override is
//      disclosed (a structural reason code), never silent.
//   2. PRIVACY prevents any frontier/cloud provider from being selected — at the router AND at the
//      adapter seam — even with a key, mesh, escalate, and a hard prompt all present.
//   3. Multi-provider FALLBACK is visible in the hops AND in the routing receipt (the full chain),
//      even when the first provider succeeds and the rest are never touched.
//   4. No SILENT model/provider swap: whenever what was served differs from what was asked for, the
//      receipt discloses BOTH the requested model and the served provider.
//
// Hermetic: injected fake providers, no network (each provider.call() is a local stub).
import assert from 'node:assert';
import { route } from './src/routing/model-router.js';
import { selectAndComplete } from './src/routing/model-adapter.js';

let pass = 0;
const ok = async (name, fn) => { await fn(); console.log(`  ✓ ${name}`); pass++; };

console.log('routing honesty (issue #1) — explicit choice, privacy, visible fallback, no silent swap\n');

// fake provider: records calls, no network. Mirrors test-model-adapter's factory.
const mk = (id, kind, opts = {}) => {
  const p = {
    id, kind, calls: 0,
    capability: opts.capability, costClass: opts.costClass, costHint: opts.costHint,
    async call(req) {
      p.calls++;
      if (opts.fail) {
        if (opts.failKind === 'notok') return { ok: false, error: `${id} not-ok` };
        throw new Error(`${id} boom`);
      }
      return { ok: true, text: `${id}:${(req.prompt || '').slice(0, 8)}`, served: id };
    },
  };
  return p;
};

// ── INVARIANT 1 — an explicit model choice is honored, and never silently overridden ─────────────
await ok('explicit model choice is HONORED by the router (cloud + local families)', () => {
  const cloud = route({ prompt: 'plan this', model: 'claude-opus' });
  assert.strictEqual(cloud.requestedModel, 'claude-opus', 'router must echo the caller\'s requested model');
  assert.strictEqual(cloud.model, 'claude-opus', 'an explicit cloud model must be the model actually used');
  assert.strictEqual(cloud.cloud, true);
  assert.strictEqual(cloud.override, null, 'an honored choice carries NO override');

  const local = route({ prompt: 'plan this', model: 'qwen2.5:7b' });
  assert.strictEqual(local.requestedModel, 'qwen2.5:7b');
  assert.strictEqual(local.model, 'qwen2.5:7b', 'an explicit local model must be honored verbatim');
  assert.strictEqual(local.cloud, false);
  assert.strictEqual(local.override, null);
});

await ok('a dropped explicit choice is NEVER silent — the override is always named', () => {
  // The ONLY case where an explicit model is dropped is privacy overriding a cloud model.
  const r = route({ prompt: 'analyze my notes', model: 'gpt-5', private: true });
  assert.strictEqual(r.requestedModel, 'gpt-5', 'the dropped request is still recorded');
  assert.strictEqual(r.model, null, 'the cloud model was NOT used');
  assert.strictEqual(r.cloud, false, 'privacy kept it local');
  assert.strictEqual(r.override, 'privacy', 'the drop is disclosed with a structural override code');

  // META-INVARIANT across the decision space: requested ≠ used  ⟹  override is named. No silent drop.
  const space = [
    { prompt: 'x', model: 'gpt-5' },
    { prompt: 'x', model: 'gpt-5', private: true },
    { prompt: 'x', model: 'claude-opus' },
    { prompt: 'x', model: 'deepseek/deepseek-chat' },
    { prompt: 'x', model: 'deepseek/deepseek-chat', private: true },
    { prompt: 'x', model: 'qwen2.5:7b' },
    { prompt: 'x', model: 'llama3.1:8b', private: true },
    { prompt: 'a'.repeat(2000), model: 'mistral:7b' },
  ];
  for (const req of space) {
    const d = route(req, { hasFrontierKey: true, meshAvailable: true });
    if (d.requestedModel != null && d.model !== d.requestedModel) {
      assert.ok(typeof d.override === 'string' && d.override.length > 0,
        `requested "${d.requestedModel}" but used "${d.model}" with NO override — that is a SILENT override`);
    }
  }
});

await ok('the adapter receipt echoes the requested model — a swap is impossible to hide', async () => {
  const frontier = mk('anthropic', 'frontier', { capability: 5 });
  const local = mk('local-gemma', 'openweight', { capability: 3, costClass: 'local' });
  const out = await selectAndComplete({
    task: { prompt: 'architect a system', model: 'claude-opus' }, classHint: 'reasoning',
    providers: [local, frontier], ctx: { hasFrontierKey: true },
  });
  assert.strictEqual(out.requestedModel, 'claude-opus', 'the result echoes the requested model');
  assert.strictEqual(out.receipt.requestedModel, 'claude-opus', 'the receipt echoes the requested model');
  assert.strictEqual(out.receipt.served.provider, out.provider, 'the receipt names the provider that ACTUALLY served');
  assert.strictEqual(out.receipt.served.provider, 'anthropic');
  assert.strictEqual(out.receipt.override, null, 'an honored cloud choice carries no override');
});

// ── INVARIANT 2 — privacy prevents frontier/cloud selection, end to end ──────────────────────────
await ok('PRIVACY prevents cloud at the router — even with key + mesh + escalate + a hard prompt', () => {
  const r = route(
    { prompt: 'prove this complex theorem '.repeat(60), private: true, escalate: true, model: 'gpt-5' },
    { hasFrontierKey: true, meshAvailable: true },
  );
  assert.strictEqual(r.cloud, false, 'privacy must force cloud:false');
  assert.ok(r.tier.startsWith('local'), `privacy must stay local, got tier "${r.tier}" (not mesh, not frontier)`);
});

await ok('PRIVACY prevents a frontier provider from being SELECTED or CALLED at the adapter seam', async () => {
  const frontier = mk('openai', 'frontier', { capability: 5 });
  const local = mk('local-gemma', 'openweight', { capability: 3, costClass: 'local' });
  const out = await selectAndComplete({
    task: { prompt: 'highly complex reasoning '.repeat(60), model: 'gpt-5' }, // a cloud model is even requested…
    classHint: 'reasoning', privacy: true,                                    // …but privacy forbids cloud
    providers: [frontier, local], ctx: { hasFrontierKey: true, meshAvailable: true },
  });
  assert.strictEqual(out.kind, 'openweight', 'a private task must be served open-weight/local');
  assert.strictEqual(out.cloud, false);
  assert.strictEqual(out.receipt.cloud, false, 'the receipt must record cloud:false for a private task');
  assert.strictEqual(out.receipt.private, true, 'the receipt must record the privacy posture');
  assert.strictEqual(frontier.calls, 0, 'a frontier provider must NEVER be called for a private task');
  // the frontier provider must not even appear in the fallback chain that privacy was supposed to strip.
  assert.ok(!out.fallbackChain.includes('openai'), 'a privacy-stripped frontier provider must not be in the chain');
});

// ── INVARIANT 3 — multi-provider fallback is visible in hops AND in the receipt ──────────────────
await ok('the FULL fallback chain is visible in hops + receipt even when the first provider succeeds', async () => {
  const a = mk('frontier-a', 'frontier', { capability: 5 });
  const b = mk('frontier-b', 'frontier', { capability: 5 });
  const c = mk('frontier-c', 'frontier', { capability: 5 });
  const out = await selectAndComplete({
    task: { prompt: 'architect the system', model: 'gpt-5' }, classHint: 'reasoning',
    providers: [a, b, c], ctx: { hasFrontierKey: true },
  });
  assert.ok(Array.isArray(out.fallbackChain), 'the result exposes a fallbackChain');
  assert.strictEqual(out.fallbackChain.length, 3, 'all 3 providers are in the visible chain');
  assert.deepStrictEqual([...out.fallbackChain].sort(), ['frontier-a', 'frontier-b', 'frontier-c']);
  assert.deepStrictEqual(out.receipt.fallbackChain, out.fallbackChain, 'the receipt carries the same full chain');
  // the chain is recorded in the hop log too (the 'order' hop) — before any call ran.
  const orderHop = out.hops.find((h) => h.stage === 'order');
  assert.ok(orderHop && Array.isArray(orderHop.chain), 'an order hop records the chain');
  assert.deepStrictEqual(orderHop.chain, out.fallbackChain);
  // only the first provider actually served; the rest are visible-but-untouched.
  assert.strictEqual(a.calls + b.calls + c.calls, 1, 'exactly one provider was actually called');
});

await ok('a real fallback (first provider fails) is visible hop-by-hop, in order', async () => {
  const a = mk('frontier-a', 'frontier', { capability: 5, fail: true });               // throws
  const b = mk('frontier-b', 'frontier', { capability: 5, fail: true, failKind: 'notok' }); // {ok:false}
  const c = mk('frontier-c', 'frontier', { capability: 5 });                            // succeeds
  const out = await selectAndComplete({
    task: { prompt: 'architect the system', model: 'gpt-5' }, classHint: 'reasoning',
    providers: [a, b, c], ctx: { hasFrontierKey: true },
  });
  assert.strictEqual(out.provider, 'frontier-c', 'fell through to the first healthy provider');
  const callHops = out.hops.filter((h) => h.stage === 'call');
  assert.deepStrictEqual(callHops.map((h) => [h.provider, h.ok]), [
    ['frontier-a', false], ['frontier-b', false], ['frontier-c', true],
  ], 'every fallback hop is visible, in order, with its outcome');
  assert.ok(callHops[0].error && callHops[1].error, 'each failed hop carries an honest error');
  assert.strictEqual(out.receipt.served.provider, 'frontier-c', 'the receipt names what finally served');
});

await ok('an exhausted chain fails deterministically and STILL exposes the full chain', async () => {
  const a = mk('local-a', 'openweight', { capability: 3, costClass: 'local', fail: true });
  const b = mk('local-b', 'openweight', { capability: 3, costClass: 'local', fail: true });
  await assert.rejects(
    () => selectAndComplete({ task: { prompt: 'hi' }, providers: [a, b] }),
    (err) => {
      assert.ok(/all 2 provider\(s\) failed/.test(err.message), 'honest exhaustion message');
      assert.deepStrictEqual([...(err.fallbackChain || [])].sort(), ['local-a', 'local-b'],
        'the error exposes the full fallback chain that was tried');
      assert.ok(Array.isArray(err.hops) && err.hops.filter((h) => h.stage === 'call' && h.ok === false).length === 2,
        'both failed hops are visible on the error');
      return true;
    },
  );
});

// ── INVARIANT 4 — a model/provider swap is disclosed, never silent ───────────────────────────────
await ok('a cloud-asked / local-served SWAP is fully disclosed in the receipt (not silent)', async () => {
  const frontier = mk('openai', 'frontier', { capability: 5 });
  const local = mk('local-gemma', 'openweight', { capability: 3, costClass: 'local' });
  // The caller explicitly asks for a CLOUD model, but marks the task private → it is served LOCALLY.
  const out = await selectAndComplete({
    task: { prompt: 'summarize my private notes', model: 'gpt-5' }, classHint: 'general', privacy: true,
    providers: [frontier, local], ctx: { hasFrontierKey: true },
  });
  // The swap (cloud requested → local served) must be visible in EVERY honest field:
  assert.strictEqual(out.receipt.requestedModel, 'gpt-5', 'the requested cloud model is disclosed');
  assert.strictEqual(out.receipt.routerModel, null, 'the cloud model was NOT used');
  assert.strictEqual(out.receipt.served.provider, 'local-gemma', 'the actual server is disclosed');
  assert.strictEqual(out.receipt.served.kind, 'openweight');
  assert.strictEqual(out.receipt.override, 'privacy', 'the reason for the swap is named');
  assert.strictEqual(out.receipt.cloud, false);
  assert.strictEqual(frontier.calls, 0, 'the requested cloud provider was never reached');
  // and the result-level mirror of the override is consistent (no field lies about another):
  assert.strictEqual(out.override, 'privacy');
});

console.log(`\n✅ ${pass}/${pass} routing-honesty tests passed — explicit choice honored, privacy enforced, fallback visible, no silent swap.`);
