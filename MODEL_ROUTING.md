# StratosAgent — Model Routing (public operating core)

**Status:** implemented in this repo — `src/routing/model-router.js` + `src/routing/model-adapter.js`,
verified by `test-model-router` and `test-model-adapter`.

How StratosAgent chooses a model. The design choice is deliberate: **one simple, honest router — not a
four-layer ML routing stack.** Local is the default; the cloud is never silent.

---

## The router

`route(request, ctx) → { tier, cloud, model?, difficulty, reason }`. A single transparent policy with
an honest, human-readable `reason` on every decision.

### Tiers

```js
['local-fast', 'local-strong', 'mesh', 'frontier']
```

- `local-fast` / `local-strong` — local open-weight (e.g. via Ollama); the router picks the *tier*, you
  pick the concrete local model behind the adapter seam.
- `mesh` — your other machines (still sovereign), only when a real fleet exists.
- `frontier` — your own cloud AI account (you bring the key — sometimes called "BYOK"), **opt-in only**.

### Decision order (as coded and tested)

1. **Explicit model.** A deliberately-passed model is honored. A cloud-family slug (e.g.
   `gpt`/`o`-series/`claude`/`gemini`/`grok`, or any `vendor/model` slash slug) ⇒ `frontier` — *unless*
   `private`, which keeps it local. A local-family name ⇒ a local tier by difficulty.
   - **Sovereignty guard:** an OpenAI-compatible client auto-sends a model on every call (often a
     default like `gpt-4o`). Treating that as opt-in would silently break sovereignty, so a wire model
     should not be passed here as an explicit choice.
2. **Privacy.** `request.private === true` ⇒ **local only** — never cloud, never mesh. Overrides cost
   and capability.
3. **Cloud escalation — opt-in only.** `escalate && hasFrontierKey && difficulty >= 4` ⇒ `frontier`.
   `autoEscalateEnabled()` requires an explicit env opt-in (default OFF) — closing the
   heuristic-injection / forced-spend + data-egress vector.
4. **Mesh.** `difficulty >= 4 && meshAvailable` ⇒ `mesh` (`src/routing/mesh-signal.js`).
5. **Default.** Local — `local-strong` if `difficulty >= 3`, else `local-fast`.

### Difficulty signal — honest heuristic, not a classifier

`difficulty(prompt)` returns 0–5 from length plus a few markers (reasoning verbs, code fences, math).
It is documented in-code as a heuristic, not an ML model.

### Mesh availability — never invents peers

`src/routing/mesh-signal.js` reads a self-reported `fleet.json`, deny-by-default. It returns **false**
with no fleet (the honest default), and flips true only when a live node writes `nodes>0 + cores>0`. It
honors a liveness window (stale fleets read as unavailable) and an env hard-override.

---

## The adapter seam

`src/routing/model-adapter.js` is the single provider interface — `{ id, kind, call, … }` — where
local, frontier (your own account), and user-provided models all plug in. Selection follows the same precedence the
router enforces:

```
Privacy  >  Capability  >  Cost  >  Fallback
```

- **Privacy** — a sensitive task never reaches a frontier provider, full stop.
- **Capability** — high-reasoning work routes to a capable tier when cloud is allowed; batch/extraction
  stays open-weight/local.
- **Cost** — the cheaper adequate provider wins; **local ($0)** beats a frontier provider when local is
  capability-adequate.
- **Fallback** — on provider error the adapter degrades along an explicit chain, logging each hop, and
  fails **deterministically** with the full hop log if the whole chain is exhausted.

No model SDK is bundled — you supply providers behind this seam. The tests inject stub providers and
prove the precedence with **no network**.

---

## What's recorded

Every invocation records `model_used` + `model_class` in the trace (`TRACE_SCHEMA.md`); the capability
receipt (`src/ledger/capability-receipt.js`, `inference` action) is the live cryptographic record of a
run, verifiable with the public key only.

---

## Summary

The sovereign decision policy (**local-default, privacy-forces-local, opt-in cloud, real mesh signal**)
and the **Privacy > Capability > Cost > Fallback** adapter seam are both implemented and hermetically
tested in this repo.
