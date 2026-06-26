# STATE OF REALITY — StratosAgent (public operating core)

> **Honesty document.** This repository is the **publicly-auditable operating core** of StratosAgent —
> not the whole product. It contains the engines, formats, verifiers, and interfaces you can read,
> run, and verify for yourself. It deliberately does **not** contain the private learning/economic
> "flywheel" (how the agent compounds skills and accounts for value) or the private connector/broker
> internals. This file tells you exactly what is real in *this repo*, scored honestly.
>
> Legend: ✅ **WORKING** (real, hermetically tested here) · 🟡 **PARTIAL** (real code, narrow scope or
> needs wiring you provide) · 🔒 **NOT IN THIS REPO** (lives in the private build — interface only here).

## One-paragraph truth

What ships here is real and tested: a **files-first operating core** (workspace → context capture →
trace → eval) where the durable asset is plain files on disk; a **publicly verifiable capability-receipt**
format with a verifier that checks a PQC-signed, hash-chained proof using the **public key only**; a
**signed-skill (SKILL.md) verify-before-run** path that treats any foreign skill as untrusted by
default; and a **local-default model router** where the cloud is never silent (privacy pins local; cloud
is opt-in). Every state-changing CLI command is **capability-gated, deny-by-default**. The capture,
trace, and eval commands are **deterministic** — no LLM, no network — so the tests are hermetic and the
behavior is reproducible. What is **not** here, by design: the skill-induction / self-improvement
*generation* code, the economic/reward accounting, and the private connector/broker internals. The
self-improvement loop is documented here as an **interface spec**, not as the generator.

---

## ✅ WORKING — real and hermetically tested in this repo

| Component | Evidence (run `npm test`) |
| :-- | :-- |
| Files-first workspace tree (Workspace > Project > Workflow > Task) | `test-operating-core`, `test-icm-workspace` |
| Deterministic context capture (capture → classify → store, no LLM/network) | `test-operating-core` |
| Trace engine (start → steps → end) with a signed receipt spine | `test-operating-core` |
| **Capability-receipt format + verifier** (PQC-signed, hash-chained, public-key-only verify) | `test-operating-core`, the `receipt verify` demo |
| Fail-closed verification: tampered receipt/trace is rejected | `test-eval-engine` (verify-as-a-criterion) |
| Deterministic eval rubric (result-ok · no-error-steps · outputs-present · cost-within-budget · trace-integrity) | `test-eval-engine` |
| **Signed-skill / SKILL.md portability** (import untrusted-by-default, export with provenance) | `test-skill-md`, `test-skill-seal` |
| Hybrid post-quantum crypto: X25519 + ML-KEM-768, Ed25519 + ML-DSA-65 (FIPS 203/204 via `@noble/post-quantum`) | `test-skill-seal` |
| **Capability gate** — least-privilege, deny-by-default (anti path-traversal proven) | `test-capability-gate` |
| **Sovereign model router** — local by default, privacy pins local, cloud opt-in only | `test-model-router` |
| Model-adapter precedence — Privacy > Capability > Cost > Fallback (provider seam) | `test-model-adapter` |
| Mesh signal — honest "false until a real fleet exists," never invents peers | `test-mesh-signal` |
| Operating-tap — fail-open instrumentation that never breaks the host call | `test-operating-tap` |
| Real local completion (gateway POST → signed receipt → persisted output → re-verify; down gateway fails closed) | `test-complete` |
| Receipt export → verify → tamper bundle (public-key-only) | `test-receipt-export` |
| Release-provenance gate (version / node-gate / secret-scan / summary, hermetic) | `test-release-provenance` |
| Router honesty — explicit choice honored, privacy enforced, fallback visible, no silent swap | `test-routing-honesty`, `test-routing-honesty-adapter-override` |
| Neuro-symbolic checks | `test-neuro-symbolic` |
| Doctor — reports honestly, fixes nothing | `test-doctor` |

Total: 17 hermetic suites (174 assertions), all green, no network and no LLM required.

---

## 🟡 PARTIAL — real code, narrow scope or you-provide-the-wiring

| Component | Reality |
| :-- | :-- |
| Model router / adapter | The **decision** is real and tested; actually *calling* a model is left to you (provide a local Ollama endpoint or your own cloud provider account through the adapter seam). No provider is bundled. |
| Self-improvement loop | Documented here as an **interface spec** (`SELF_IMPROVEMENT_LOOP.md`): the trace → eval → candidate-lesson seam is real and tested; the lesson **generator/compiler** is not in this repo. |
| Mesh routing | The router can target a mesh tier, and `mesh-signal` reads a self-reported `fleet.json` honestly — but this repo ships **no** mesh transport. The public node runtime lives in the companion `TheAtmosphere` repo. |

---

## 🔒 NOT IN THIS REPO — private build (interface only here)

These are intentionally excluded. Where an interface or format is useful publicly, it is documented or
verifiable here; the *generation/accounting* code is not.

- **Skill induction / self-improvement generation** — how the agent compresses traces into new skills.
- **Economic / reward accounting** — attribution-to-value, settlement, any payout math.
- **Private connectors / broker internals** — credential brokering, tool execution, MCP/process bridges.
- **Private mesh internals** — bootstrap topology and operator infrastructure.

> Rule of thumb: this repo publishes the **standard + the proof** (formats, verifiers, interfaces,
> honest status) so anyone can audit, trust, and run it. The **flywheel** (how it learns and accounts
> for value) stays private.

---

## How to verify the honesty of this file

```bash
npm install
npm test          # all 17 hermetic suites (174 assertions) — they fail if any claim above breaks
node bin/stratos.js help
```

Then exercise the operating core end to end and verify a receipt with the public key only — see the
quickstart in `README.md`.
