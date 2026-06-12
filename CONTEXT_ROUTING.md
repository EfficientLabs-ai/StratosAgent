# StratosAgent — Context Routing (public operating core)

**Status:** the context/data-flow of this repo. Every stage below cites code that ships here.

How context moves through the public operating core, along the canonical pipeline:

```
Input → Capture → Classify → Route → Store → Trace → Evaluate → ( Improve )
```

The standard is simple: **no context lives only in chat.** Capture is deterministic, storage is plain
files, the route is local-first, and every run leaves a verifiable trace. The *Improve* leg's generator
is private (see `SELF_IMPROVEMENT_LOOP.md`); everything else here is in-repo and tested.

---

## 1. Input

Inputs arrive through the CLI (`src/cli/stratos-cli.js` / `bin/stratos.js`). Each command names a task
path in the operational tree (`workspace/project/workflow/task`). You bring the surface (a terminal, a
script, your own integration); this repo defines the structure underneath it.

## 2. Capture — deterministic, no LLM/network

`src/context/context-capture.js` implements **Capture → Classify → Store** with no model call and no
network. Given a task path, a source (`chat|file|repo|terminal|browser|api|mcp`), and raw text, it:

- writes the raw payload to the task's `data/`,
- classifies it with a rule-based heuristic (e.g. `question`, `instruction`),
- writes a structured record to the task's `memory/`,
- appends a line to the workspace `session.log`.

Because it is deterministic, the same input always produces the same record — which is why the tests are
hermetic.

## 3. Classify

Two deterministic classifiers ship here: the capture classifier (above), and the router's
`difficulty()` heuristic (`src/routing/model-router.js`) which scores a prompt's hardness 0–5. Both are
pure functions — no LLM, no network.

## 4. Route — local-first, cloud never silent

`src/routing/model-router.js` `route(request, ctx)` decides the model tier under a fixed precedence:

```
Privacy  >  Capability  >  Cost  >  Fallback
```

- **local-default** — the sovereign default for normal work;
- `private: true` **pins local** — never cloud, never mesh;
- **cloud is opt-in only** — it requires an explicit escalation flag *and* a frontier key *and* genuine
  difficulty; a model name auto-sent by a client never forces cloud;
- **mesh** tier is chosen for heavy work only when `src/routing/mesh-signal.js` reports a real
  `fleet.json` (it never invents peers).

`src/routing/model-adapter.js` is the provider seam — `{ id, kind, call, … }` — letting you plug a
local Ollama endpoint or your own cloud provider behind the same decision. See `MODEL_ROUTING.md` for the full
table.

## 5. Store — the filesystem is the contract

`src/workspace/workspace-tree.js` scaffolds the operational tree; each Task folder holds the eight
canonical entries:

```
instructions.md · tools.json · data/ · memory/ · outputs/ · traces/ · evals/ · skills/
```

`src/context/icm-workspace.js` scaffolds and validates the 5-layer "folders over agents" workspace
contract. Imported foreign skills live in a **separate, untrusted** index
(`src/skills/skill-store.js`) so they can never masquerade as sealed ones.

## 6. Trace — the cryptographic spine

`src/trace/trace-engine.js` writes `traces/{task-id}.json` and mints a PQC-signed, hash-chained
**capability receipt** (`src/ledger/capability-receipt.js`) verifiable with the public key only. Full
schema in `TRACE_SCHEMA.md`.

## 7. Evaluate

`src/eval/eval-engine.js` scores a finished trace against a deterministic rubric (incl.
verify-as-a-criterion) and writes `evals/{task-id}.md` + `.json`, linking back into the trace.

## 8. Improve (seam here, generator private)

Each failed eval criterion emits a structured **candidate lesson** — the public handoff contract. The
generator that turns lessons into sealed, reusable skills is the private flywheel; its public contracts
(seal, capabilities, receipt) are all verifiable here. See `SELF_IMPROVEMENT_LOOP.md`.

---

## Context-isolation invariants (security-critical, in this repo)

- **Deny-by-default capability gating** — `src/security/capability-gate.js`: a step may do ONLY what its
  declared capabilities allow; path-prefix boundaries are not foolable (`/data/skills-evil` ⊄
  `/data/skills`).
- **Untrusted input quarantine** — foreign SKILL.md imports are untrusted-by-default, capability-gated,
  and never auto-run (`src/skills/skill-md.js`); only a sealed, locally re-sealed skill can touch
  net / fs / secrets / compute.
- **Public-key-only proof** — receipts carry hashes, never content, and verify with the public key — so
  a trace can be audited by a third party with no access to the originating node.

---

## Summary

**Capture, Route, Store, Trace, and Evaluate** are complete and tested in this repo. The **Improve**
generator is private; its interface and proofs are public.
