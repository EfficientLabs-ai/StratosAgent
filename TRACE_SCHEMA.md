# TRACE_SCHEMA — the StratosAgent trace record

**Status:** implemented in this repo (`src/trace/trace-engine.js`), verified by `test-operating-core`.

A **trace** is the honest operational record of one task execution: what model ran it, the ordered
steps it took, what each step touched, the outputs, and a cryptographic proof spine. It is plain JSON
on disk, and its integrity is verifiable with a public key — never content, only hashes.

## The record — `traces/{task-id}.json`

```jsonc
{
  "task_id": "t1",
  "parent_task": null,
  "workspace": "demo", "project": "proj", "workflow": "flow",
  "started": "2026-06-07T12:12:49.653Z",
  "ended":   "2026-06-07T12:12:49.653Z",
  "model_used": "gemma2:2b",
  "model_class": "openweight",
  "steps": [
    {
      "i": 0,
      "kind": "plan",                 // plan · tool · model · subagent · io
      "summary": "plan the task",
      "tool": "",
      "who": "did:atmos:199d0988…",   // the actor identity (derived from a public key)
      "model": "gemma2:2b",
      "permission": "plan",           // the capability that allowed this step
      "input_hash":  "e3b0c442…",     // sha256 of input  — hash, never content
      "output_hash": "e3b0c442…",     // sha256 of output — hash, never content
      "approval": false,
      "cost_units": 0
    }
  ],
  "tools_used": [],
  "outputs": ["done"],
  "approval_required": false,
  "approved_by": "",
  "result": "ok",
  "receipt_path": "(in-memory)#…",    // pointer to the signed capability-receipt spine
  "eval_path": "/…/evals/t1.md"       // linked back when the trace is evaluated
}
```

### Invariants

- **Every step logs** who requested it (`who`), which model (`model`), what permission allowed it
  (`permission`), the input/output **hashes** (never raw content), whether approval was required, and a
  cost in abstract units.
- **The capability receipt is the cryptographic spine.** Where the receipt and the trace overlap, the
  receipt is the source of truth — it is the tamper-evident, signed, hash-chained record.
- **Fail-open writing, fail-closed verifying.** If the receipt signer throws, the trace is still
  written (you never lose the record) but no receipt is minted; verification, by contrast, fails closed
  on any tampering.

## The capability receipt (the spine)

`src/ledger/capability-receipt.js` mints a **PQC-signed, hash-chained** receipt per attested run:
`action` (one of `inference` / `skill-run`) · `actor_id` · `input_hash` · `output_hash` · `cost_units`
· `prev_hash` · `hash` · `sig`. It is verifiable with the node's **public key only**:

```bash
# export a self-contained bundle (public key + receipts), then verify it anywhere:
node bin/stratos.js receipt verify ./bundle.json
# ✓ OK — every signature + the full hash chain verified with the public key only.
```

Tamper with any field and verification returns **✗ BROKEN (at index N)** — fail-closed, by design.

## The eval link

When you run `stratos eval <task>`, the eval engine reads `traces/{task-id}.json`, scores it against a
deterministic rubric (including a **trace-integrity** criterion that re-runs the receipt verify), and
writes `evals/{task-id}.json` + `.md`, linking `eval_path` back into the trace. See `eval-engine.js`
and `SELF_IMPROVEMENT_LOOP.md`.

## Pointers

- Trace writer: `src/trace/trace-engine.js`
- Receipt format + verifier: `src/ledger/capability-receipt.js`
- Where traces originate (capture): `CONTEXT_ROUTING.md`
- What consumes traces (eval + lesson seam): `SELF_IMPROVEMENT_LOOP.md`
