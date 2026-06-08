# StratosAgent — Self-Improvement Loop (interface spec)

**Status:** interface specification. This document defines the **public seam** of the self-improvement
loop. The seam — and the parts of the loop that are publicly verifiable — are implemented in this repo
and covered by hermetic tests. The **generator** that turns a lesson into a new skill is part of the
private build and is intentionally **not** published here.

The flywheel, conceptually:

```
trace → evaluation → candidate lesson → ( updated instruction → reusable skill )
        └──────── public seam (here) ────────┘   └──── private generator (not here) ────┘
```

> **Why an interface, not the generator.** This repo publishes the **standard + the proof**: the
> formats and verifiers anyone can audit, and the seam any implementation must honor. *How* the agent
> compresses a lesson into a compounding skill is the moat and stays private. Publishing the interface
> lets you build on the loop and verify its outputs without the private learning code.

---

## Stage 1 — TRACE (public, in this repo)

`src/trace/trace-engine.js` records a task as `start → steps → end`, writing
`traces/{task-id}.json` and minting a **PQC-signed, hash-chained capability-receipt** as the
tamper-evident spine (`src/ledger/capability-receipt.js`). The receipt is verifiable with the **public
key only** — see `TRACE_SCHEMA.md`.

## Stage 2 — EVALUATE (public, in this repo)

`src/eval/eval-engine.js` scores a finished trace against a **deterministic** rubric (no LLM, no
network) and writes `evals/{task-id}.md` + `.json`, linking the eval back into the trace. The default
criteria are:

```
result-ok · no-error-steps · outputs-present · cost-within-budget · trace-integrity
```

`trace-integrity` is **verify-as-a-criterion**: it re-runs the receipt-verify path, so a tampered trace
or receipt **fails closed** rather than producing a fabricated score.

## Stage 3 — CANDIDATE LESSON (public seam, in this repo)

Every failed criterion emits a **candidate lesson** in the eval record:

```json
{
  "criterion": "trace-integrity",
  "severity": "high",
  "suggested_instruction": "The trace's tamper-evident receipt did not verify; do NOT trust this run's outputs — re-execute and re-sign."
}
```

This is the **handoff contract**. A candidate lesson is structured, honest, and self-contained: a
criterion id, a severity, and a suggested instruction. Anything downstream — your own tooling, or the
private generator — consumes lessons in exactly this shape.

## Stage 4 — GENERATE (private — interface only here)

Turning candidate lessons into updated instructions and reusable, sealed skills is the private
learning/economic flywheel. It is **not** in this repo. Its public contracts that *do* live here:

- **Skill seal / verify** (`src/memory/skill-seal.js`) — the hybrid Ed25519 + ML-DSA-65 seal binds a
  skill's identity to its contents; editing the code or its declared capabilities breaks the seal.
- **Capability gate** (`src/security/capability-gate.js`) — a generated skill may do ONLY what its
  declared capabilities allow; absent ⇒ denied.
- **SKILL.md portability** (`src/skills/skill-md.js`, `src/skills/skill-store.js`) — generated skills
  export to the portable SKILL.md format with provenance; imported foreign skills are untrusted by
  default and indexed separately so they can never masquerade as sealed ones.

So: even though the generator is private, anything it produces is **verifiable here** — the seal, the
capabilities, and the receipt are all public contracts.

---

## The portability rail (public)

`src/skills/skill-md.js` imports/exports the portable SKILL.md format (agentskills.io / clawhub
interop) **without discarding the sovereign seal**. A foreign `.md` is untrusted-by-default,
capability-gated, and never auto-run; only a sealed skill (which requires this node's key) can touch
net / fs / secrets / compute. Imported skills are indexed separately (`src/skills/skill-store.js`) so a
foreign skill can never masquerade as a sealed one.

---

## Summary

The **trace → eval → candidate-lesson** seam is real, deterministic, and hermetically tested in this
repo, and its outputs (receipts, seals, capabilities) are publicly verifiable. The **lesson →
instruction → reusable skill** generator is the private flywheel and is documented here only as the
interface it must honor.
