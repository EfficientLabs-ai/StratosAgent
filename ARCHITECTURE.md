# StratosAgent — Architecture (public operating core)

**Status:** the publicly-auditable operating core. Every file named here is in this repository; the
private learning/economic flywheel and the private connector/broker internals are intentionally *not*.

StratosAgent is an **operating core** for agents — the durable structure underneath a model: it
organizes work as files, captures context, traces what happened, evaluates it against a deterministic
rubric, verifies a cryptographic proof of each run, verifies foreign skills before they run, and routes
to a model **local-first**. It is not an agent framework; it is the layer that makes any agent
auditable and sovereign.

> **Honesty bar.** `STATE_OF_REALITY.md` is the source of truth for what is real in this repo. This
> document describes only code that exists here. The companion docs — `CONTEXT_ROUTING.md`,
> `MODEL_ROUTING.md`, `TRACE_SCHEMA.md`, `SELF_IMPROVEMENT_LOOP.md` — go deeper per subsystem.

---

## The primitive

Everything is the operational unit `Workspace > Project > Workflow > Task > Subtask`. Each Task folder
holds the eight canonical entries:

```
instructions.md · tools.json · data/ · memory/ · outputs/ · traces/ · evals/ · skills/
```

and flows through the pipeline:

```
Input → Capture → Classify → Route → Store → Execute → Trace → Evaluate → ( Improve )
```

**The filesystem is the contract.** The model is a swappable detail behind it. The durable asset is
your living operational map — plain files on disk, framework-agnostic.

---

## Source layout (what ships in this repo)

```
src/
  cli/        stratos-cli.js     the public CLI core (workspace/task/capture/trace/eval, skill, route, receipt verify)
  workspace/  workspace-tree.js  the files-first operational unit (create/scaffold/tree/resolve)
  context/    context-capture.js deterministic Capture → Classify → Store (no LLM/network)
              icm-workspace.js   the 5-layer "folders over agents" workspace contract
  trace/      trace-engine.js    start → steps → end; writes traces/{task}.json with a receipt spine
  eval/       eval-engine.js     deterministic scored rubric incl. verify-as-a-criterion
  operating/  operating-tap.js   fail-open instrumentation seam (never breaks the host call)
  ledger/     capability-receipt.js  the signed, hash-chained receipt FORMAT + verifier + bundle export/verify
  memory/     skill-seal.js      hybrid-PQC seal + originId (the verify side of signed skills)
  skills/     skill-md.js        SKILL.md portability (parse/import-untrusted/export)
              skill-store.js     imported-skill index (untrusted store)
  routing/    model-router.js    one sovereign router (local-default, privacy pins local, cloud opt-in)
              model-adapter.js   provider-adapter seam: { id, kind, call, … }
              mesh-signal.js     honest fleet.json signal (never invents peers)
  security/   capability-gate.js capability declaration + assertStepAllowed (deny-by-default)
              quantum-crypto.js  ML-DSA-65 + Ed25519 sign/verify, ML-KEM-768 key agreement
bin/
  stratos.js  the `stratos` entrypoint (thin wrapper around src/cli/stratos-cli.js)
```

---

## Layered view (this repo)

```
   FRONT DOOR   ──  cli/stratos-cli.js  ·  bin/stratos.js
                       │
   ROUTE        ──  routing/model-router.js (local-default · privacy · opt-in cloud)
                    routing/model-adapter.js (provider seam)  ·  routing/mesh-signal.js
                       │
   CAPTURE      ──  context/context-capture.js (deterministic Capture → Classify → Store)
                       │
   TRACE/PROOF  ──  trace/trace-engine.js  →  ledger/capability-receipt.js
                    (PQC-signed, hash-chained; verifiable with the PUBLIC key only)
                       │
   EVAL         ──  eval/eval-engine.js (scored rubric; trace-integrity = verify-as-a-criterion)
                       │
   IMPROVE      ──  the trace → eval → candidate-lesson SEAM is here; the lesson generator
                    is private (see SELF_IMPROVEMENT_LOOP.md — interface spec only)
```

---

## Security spine (cross-cutting)

Deny-by-default everywhere:

- **Capability gate** (`src/security/capability-gate.js`) — a step may do ONLY what the caller's
  capabilities declare (compute / actions / net / fs / secrets; absent ⇒ denied). Path-prefix
  boundaries are not foolable (`/data/skills-evil` ⊄ `/data/skills`).
- **Post-quantum crypto** (`src/security/quantum-crypto.js`) — real `@noble/post-quantum` ML-DSA-65 +
  ML-KEM-768 (FIPS 203/204), hybrid with Ed25519; **both halves must verify**.
- **Signed-skill verify** (`src/memory/skill-seal.js`, `src/skills/skill-md.js`) — a foreign SKILL.md
  is **untrusted instruction by default**; net/fs/secrets/compute are never granted to it.
- **Capability-receipt proof rail** (`src/ledger/capability-receipt.js`) — every run can emit a
  signed, hash-chained receipt verifiable with **only** the node's public key (it carries hashes,
  never content). Tamper anywhere ⇒ fail-closed.

---

## What is intentionally NOT here

The skill-induction / self-improvement *generator*, the economic/reward accounting, and the private
connector/broker internals live in the private build. Where their public contract matters — the
receipt format, the skill-verify path, the router/adapter interface, the improvement-loop seam — it is
documented or verifiable here. The flywheel itself is private.
