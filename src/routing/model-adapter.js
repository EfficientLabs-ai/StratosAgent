/**
 * model-adapter.js — the UNIFIED model-adapter seam (INCREMENT 4: model-agnostic routing).
 *
 * ───────────────────────────────────────────────────────────────────────────────────────────────
 * HOW THIS COMPOSES WITH THE EXISTING ROUTER (no duplication):
 *
 *   • model-router.js  → ALREADY decides the TIER and the sovereignty law: LOCAL default,
 *     PRIVACY forces local, CLOUD is opt-in only, MESH for heavy work. We DO NOT re-implement any of
 *     that. `selectAndComplete()` calls `route()` once and treats its decision as authoritative for
 *     Privacy + (frontier-)opt-in. If `route()` says `cloud:false`, NO frontier provider can be
 *     chosen here — full stop. The adapter only ever *narrows* what the router already allowed; it
 *     can never widen it.
 *
 *   • Concrete LOCAL-model selection + the provider PROVIDERS map (BYOK key gating, provider
 *     recognition) belong downstream; this module does not duplicate provider recognition.
 *
 *   • THIS module is the seam: a single entry point that takes a task + the available
 *     pluggable provider adapters, applies the policy precedence —
 *         PRIVACY  >  CAPABILITY  >  COST  >  FALLBACK
 *     (see MODEL_ROUTING.md) — and then drives
 *     the chosen provider's `call()`. The ACTUAL network call lives INSIDE each provider's `call`
 *     (injected); this module + its tests make NO real network calls.
 *
 * A provider adapter is a plain object with a uniform shape:
 *     { id, kind:'frontier'|'openweight'|'user', call(req) -> Promise<result>,
 *       capability?: number,   // 0..5 capability score (higher = more capable)
 *       costClass?: 'local'|'mesh'|'frontier',  // marginal-cost class ($0 local/mesh < frontier)
 *       costHint?: number }    // optional finer $/req tiebreak within a cost class
 *
 * User-provided models are kind:'user' and flow through the EXACT SAME interface + precedence — no
 * special path (they are treated as open-weight-equivalent for capability/privacy unless they declare
 * otherwise). Frontier providers still require the router to have allowed cloud (BYOK + opt-in); the
 * adapter never escalates on its own.
 * ───────────────────────────────────────────────────────────────────────────────────────────────
 */
import { route } from './model-router.js';

const FRONTIER = 'frontier';
const OPENWEIGHT = 'openweight';
const USER = 'user';

// Cost ordering: $0 paths first, frontier last. Lower = cheaper = preferred.
const COST_RANK = { local: 0, mesh: 0, openweight: 0, user: 0, frontier: 2 };
const costRank = (p) => {
  if (typeof p.costClass === 'string' && p.costClass in COST_RANK) return COST_RANK[p.costClass];
  // default by kind: frontier is metered, everything else is $0 marginal (local/mesh/user hardware).
  return p.kind === FRONTIER ? COST_RANK.frontier : 0;
};

// Capability default by kind when a provider doesn't declare one: frontier is the high-reasoning tier.
const capabilityOf = (p) => (typeof p.capability === 'number' ? p.capability : (p.kind === FRONTIER ? 5 : 3));

/**
 * Map a task class hint to a minimum capability and whether it WANTS a frontier-tier provider.
 * High-reasoning classes prefer frontier (when the router allows it); batch/extraction classes are
 * happy on open-weight/local. This is a transparent table, not a classifier — honest about what it is.
 */
const CLASS_TABLE = {
  // high-reasoning / planning / architecture → wants frontier capability (if allowed)
  reasoning: { minCapability: 5, wantsFrontier: true },
  planning: { minCapability: 5, wantsFrontier: true },
  architecture: { minCapability: 5, wantsFrontier: true },
  'high-reasoning': { minCapability: 5, wantsFrontier: true },
  // batch / extraction / classification / summarize → open-weight/local is adequate
  batch: { minCapability: 1, wantsFrontier: false },
  extraction: { minCapability: 1, wantsFrontier: false },
  classification: { minCapability: 1, wantsFrontier: false },
  summarize: { minCapability: 1, wantsFrontier: false },
  general: { minCapability: 2, wantsFrontier: false },
};
const classProfile = (classHint) => CLASS_TABLE[String(classHint || 'general').toLowerCase()] || CLASS_TABLE.general;

/**
 * selectAndComplete — the one unified interface.
 *
 * @param {object} args
 * @param {object} args.task         { prompt, model? } forwarded to route() (the existing router).
 * @param {string} [args.classHint]  task-class hint ('reasoning'|'batch'|'extraction'|… see CLASS_TABLE).
 * @param {boolean}[args.privacy]    explicit privacy flag (mirrors task.private; either pins privacy).
 * @param {object} [args.budget]     { maxCostClass?: 'local'|'mesh'|'frontier' } optional spend cap.
 * @param {Array}  args.providers    pluggable adapters [{id,kind,call,capability?,costClass?,costHint?}].
 * @param {object} [args.ctx]        { hasFrontierKey?, meshAvailable? } forwarded to route().
 * @param {function}[args.log]       optional (event)=>void hop logger (defaults to a collected array).
 * @returns {Promise<{result, provider, kind, tier, cloud, reason, requestedModel, override, fallbackChain, receipt, decision, hops}>}
 */
export async function selectAndComplete({ task = {}, classHint = 'general', privacy = false, budget = {}, providers = [], ctx = {}, log } = {}) {
  if (!Array.isArray(providers) || providers.length === 0) {
    throw new Error('model-adapter: at least one provider adapter is required');
  }
  const hops = [];
  const record = (e) => { hops.push(e); if (typeof log === 'function') log(e); };

  // The caller's PINNED model (null if none). Echoed verbatim through the receipt so an explicit
  // choice can never be silently swapped: the served provider is always disclosed alongside it.
  const requestedModel = typeof task.model === 'string' && task.model ? task.model : null;

  // The request carries privacy from EITHER the explicit flag OR task.private. Then the EXISTING
  // router decides the tier + whether cloud is even allowed. We never second-guess that decision.
  const isPrivate = privacy === true || task.private === true;
  const decision = route({ ...task, private: isPrivate }, ctx);
  // The route hop carries the FULL honesty disclosure: requested vs honored model + override reason.
  record({ stage: 'route', tier: decision.tier, cloud: decision.cloud, reason: decision.reason,
    requestedModel, routerModel: decision.model ?? null, override: decision.override ?? null });

  const prof = classProfile(classHint);
  const cloudAllowed = decision.cloud === true; // router authority: privacy/opt-in already applied

  // Frontier-availability tracking for the FINAL adapter-layer override (issue #1). To disclose WHY an
  // explicit cloud/frontier intent ended up served by a non-frontier provider, we must remember whether
  // a frontier provider was offered at all, and whether the budget cap (not the router) stripped it.
  const hadFrontierProvider = providers.some((p) => p.kind === FRONTIER);
  let budgetStrippedFrontier = false;

  // ── PRECEDENCE STEP 1 — PRIVACY ──────────────────────────────────────────────────────────────
  // If the router did NOT allow cloud (privacy, or no opt-in), strip every frontier provider. A
  // frontier provider can NEVER be chosen when the router kept us local. This is the hard invariant.
  let candidates = providers.filter((p) => (cloudAllowed ? true : p.kind !== FRONTIER));
  record({ stage: 'privacy', cloudAllowed, kept: candidates.map((p) => p.id) });
  if (candidates.length === 0) {
    throw new Error('model-adapter: no provider survived the privacy filter (no local/open-weight provider available for a non-cloud decision)');
  }

  // ── PRECEDENCE STEP 4 (budget pre-filter, part of cost/fallback envelope) ─────────────────────
  // An optional budget cap removes anything costlier than maxCostClass (e.g. force $0-only).
  if (budget && typeof budget.maxCostClass === 'string') {
    const cap = COST_RANK[budget.maxCostClass] ?? COST_RANK.frontier;
    const frontierBeforeBudget = candidates.some((p) => p.kind === FRONTIER);
    const capped = candidates.filter((p) => costRank(p) <= cap);
    if (capped.length > 0) candidates = capped; // never empty the chain on a budget alone
    budgetStrippedFrontier = frontierBeforeBudget && !candidates.some((p) => p.kind === FRONTIER);
    record({ stage: 'budget', maxCostClass: budget.maxCostClass, kept: candidates.map((p) => p.id) });
  }

  // ── PRECEDENCE STEP 2 — CAPABILITY, then STEP 3 — COST ────────────────────────────────────────
  // Order the survivors: capability adequacy + class preference FIRST, cheaper SECOND. The resulting
  // ordered list IS the fallback chain (fallback_policy.md).
  const ordered = [...candidates].sort((a, b) => {
    // (2) capability: prefer providers that MEET the class's minimum capability.
    const aMeets = capabilityOf(a) >= prof.minCapability ? 0 : 1;
    const bMeets = capabilityOf(b) >= prof.minCapability ? 0 : 1;
    if (aMeets !== bMeets) return aMeets - bMeets;
    // (2) class preference: a frontier-wanting class prefers frontier-kind providers (when allowed).
    if (prof.wantsFrontier) {
      const aF = a.kind === FRONTIER ? 0 : 1;
      const bF = b.kind === FRONTIER ? 0 : 1;
      if (aF !== bF) return aF - bF;
    }
    // (3) cost: cheaper cost class first ($0 local/mesh/user before metered frontier).
    const cr = costRank(a) - costRank(b);
    if (cr !== 0) return cr;
    // (3) cost tiebreak: finer per-request hint, cheaper first.
    const ah = typeof a.costHint === 'number' ? a.costHint : 0;
    const bh = typeof b.costHint === 'number' ? b.costHint : 0;
    if (ah !== bh) return ah - bh;
    // stable final tiebreak: higher capability first (better default among equals).
    return capabilityOf(b) - capabilityOf(a);
  });
  // The ordered survivors ARE the fallback chain. It is recorded BEFORE any call() runs, so the full
  // multi-provider fallback path is visible even if the first provider succeeds and the rest are never
  // touched — "what we would have fallen back to" is part of the honest record, not just what ran.
  const fallbackChain = ordered.map((p) => p.id);
  record({ stage: 'order', chain: fallbackChain });

  // ── PRECEDENCE STEP 4 — FALLBACK ──────────────────────────────────────────────────────────────
  // Try each provider in order; on a thrown error OR a falsy/{ok:false} result, log the hop and
  // degrade to the next. Deterministic — no hidden retries. The actual network is INSIDE call().
  for (const p of ordered) {
    try {
      const result = await p.call({ ...task, classHint, tier: decision.tier });
      if (result && (result.ok === undefined || result.ok === true)) {
        record({ stage: 'call', provider: p.id, kind: p.kind, ok: true });

        // ── FINAL override (issue #1) ────────────────────────────────────────────────────────────
        // The override must name EVERY point where the requested explicit intent was dropped — not
        // just the router's decision. The router discloses a drop IT made (e.g. privacy). But the
        // adapter can ALSO drop an explicit cloud/frontier intent here: the router authorized cloud
        // (decision.cloud === true) for a pinned cloud model, yet a budget cap, capability/cost/class
        // precedence, or the simple absence of a frontier provider means a NON-frontier provider
        // actually served. Previously `override` was copied straight from the router, so that
        // adapter-layer downgrade was SILENT. Compute the FINAL override so the dropped frontier intent
        // is always disclosed (a structural reason code), never silent.
        const servedCloud = p.kind === FRONTIER; // honest: cloud only if a frontier provider served
        let override = decision.override ?? null;
        if (!override && decision.cloud === true && requestedModel != null && !servedCloud) {
          override = budgetStrippedFrontier ? 'budget'
            : (hadFrontierProvider ? 'precedence' : 'unavailable');
          // a dedicated, scoped hop so the adapter-introduced drop is visible in the trace too.
          record({ stage: 'override', scope: 'adapter', reason: override,
            requestedModel, routerModel: decision.model ?? null, served: p.id, servedKind: p.kind });
        }

        // The ROUTING RECEIPT: a compact, honest record of what was asked for vs what actually served,
        // the override (if the explicit choice was dropped), the cloud/privacy posture, and the full
        // fallback chain. This is what a trace/capability-receipt attests — selected provider + model +
        // fallback chain are all observable, so a silent swap is structurally impossible to hide.
        const receipt = {
          requestedModel,                         // caller's pinned model (null if none)
          routerModel: decision.model ?? null,    // the model the router actually honored
          override,                               // why an explicit choice was dropped (null = none) — router OR adapter
          served: { provider: p.id, kind: p.kind },
          tier: decision.tier,
          cloud: servedCloud,                     // honest: reflects the provider that ACTUALLY served
          private: isPrivate,
          fallbackChain,                          // FULL ordered chain — fallback always visible
        };
        record({ stage: 'select', provider: p.id, kind: p.kind, requestedModel,
          routerModel: decision.model ?? null, override,
          cloud: servedCloud, private: isPrivate, fallbackChain });
        return {
          result, provider: p.id, kind: p.kind, tier: decision.tier, cloud: servedCloud,
          reason: decision.reason, requestedModel, override,
          fallbackChain, receipt, decision, hops,
        };
      }
      record({ stage: 'call', provider: p.id, kind: p.kind, ok: false, error: (result && result.error) || 'provider returned not-ok' });
    } catch (err) {
      record({ stage: 'call', provider: p.id, kind: p.kind, ok: false, error: err && err.message ? err.message : String(err) });
    }
  }

  // Whole chain exhausted — deterministic, honest failure carrying the full hop log + fallback chain.
  const e = new Error(`model-adapter: all ${ordered.length} provider(s) failed (chain: ${fallbackChain.join(' → ')})`);
  e.hops = hops;
  e.fallbackChain = fallbackChain;
  e.requestedModel = requestedModel;
  throw e;
}

// Small helpers exported for callers/tests that want the precedence pieces without driving a call.
export const _internals = { classProfile, costRank, capabilityOf, CLASS_TABLE };
