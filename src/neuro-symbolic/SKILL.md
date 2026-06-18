---
name: neuro-symbolic
description: The System-2 runtime — deterministic FSM + workflow-as-data validation + event-log replay + graph/vector hybrid retrieval, composed into one model-agnostic execution loop. Use to gate LLM-proposed actions before execution and to keep agent state out of chat history.
---
# neuro-symbolic — the verifiable System 2

System 1 (any LLM, any provider) **PROPOSES**; this layer **DISPOSES** — deterministically, at zero model cost. State lives in the signed event log, never in chat.

Modules (`04_skills/neuro-symbolic/`, pure ESM, hermetic selftests):
- **`fsm.mjs`** — `createFSM(spec).validate(state, action, ctx)` → legal? + per-transition guards + global invariants + `legalActions()`. Emit transitions, not prose.
- **`workflow-schema.mjs`** — `validateWorkflow(tree, {allowedActions})` → reject malformed generated workflows (code-as-data/AST) **before** execution, with a precise path the LLM auto-corrects on.
- **`state-projector.mjs`** — `project` / `makeCheckpoint` / `replayFrom` → restore exact state from the append-only signed event log; idempotent (no duplicated steps) on crash/timeout.
- **`graph-query.mjs`** — `createGraph(triples)`: `match` / `dependsOn` (multi-hop) / `order` (topo) + `hybridRetrieve` (vector semantic-seed → strict graph). Exact relations embeddings can't give; embedder injectable.
- **`runtime.mjs`** — `createRuntime(deps).step(proposal)`: schema → FSM → policy → execute → record → project; every reject is deterministic + stage-named. `replay(log)` = crash continuity.

**Integration (inject the real System-2 organs):** `policy` = capability-gate (deny-by-default), `execute` = WASI-sandboxed executor, `record` = the hash-chained receipt rail. Operate per `00_truth/NEURO_SYMBOLIC_SYSTEM_PROMPT.md`.

**Verify:** `node <module>.mjs selftest` — 46 assertions across 5 modules, all green (2026-06-19).
