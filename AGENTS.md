# AGENTS.md — How agents work in this repo

> Governance for AI coding agents (Claude, Codex, and any assistant) contributing to **StratosAgent**.
> These rules are non-negotiable. If a change can't satisfy them, don't ship it.

## Two layers: execution vs. ownership

StratosAgent is one half of a two-repo system. Keep the boundary clear in code, docs, and claims:

- **StratosAgent — the EXECUTION layer.** This repo. It plans, routes, builds, and runs verifiable
  work: the System-2 runtime, model routing logic, evaluation engine, receipts, and the agent loop.
  It *executes*.
- **TheAtmosphere — the OWNERSHIP layer.** The companion repo
  ([github.com/EfficientLabs-ai/TheAtmosphere](https://github.com/EfficientLabs-ai/TheAtmosphere)).
  It owns the sovereign P2P compute mesh, node identity, settlement, and the public node runtime.
  It *owns*.

A change here may *target* or *describe an interface to* the ownership layer, but it does not
implement it. If a feature needs the mesh, node runtime, identity, or settlement to be real,
that lives in TheAtmosphere — not here. Don't claim this repo provides it.

## The truth gate (read this first)

**Only tested capability is labeled "done."** If it isn't covered by a passing test and verified to
actually run, it is not done — call it WIP, partial, or planned.

- **Every capability claim requires independent evidence.** A statement that the code does X must be
  backed by something a reviewer can re-run and observe: a passing test, captured command output, or
  an observed behavioral check. No evidence → no claim. "I believe it works" is not evidence.
- **Mocks are labeled `mock`/`stub`/`fake`** in code, comments, and docs. A mock is never described
  as a working feature.
- **No inflated status.** READMEs, changelogs, and PR descriptions describe what *is*, not what is
  hoped. Aspiration is labeled as aspiration.
- Verify against reality before claiming a result. If you didn't run it, say so.

## What you must NOT overclaim

These are the recurring overclaims for this project. Do not state, imply, or let docs/PRs suggest any
of them unless there is independent, re-runnable evidence in the same change:

- **Model routing.** The router can *target* tiers and select adapters; do not claim guaranteed
  optimal routing, live multi-provider orchestration, or capabilities the adapters don't actually
  exercise under test. Describe what the router demonstrably does, not what it aspires to.
- **Live autonomy.** This repo does not run a live, self-directing agent in production. Do not claim
  autonomous operation, self-improvement in the wild, or unattended execution beyond what tests show.
- **Payouts / settlement / economy.** No payouts, credits settlement, or economic transfer happen
  here. That is the ownership layer's concern and is founder-gated. Never claim this repo pays,
  settles, or moves value.
- **Secret handling.** This repo does not manage, store, or broker production secrets. Do not claim a
  secrets/credential capability (see *Secret hygiene*).
- **Production readiness.** Do not call anything "production-ready," "shipped to users," or "live"
  unless that is literally true and evidenced. Default to the honest lower status.

When in doubt, use the lower-status word: planned < WIP < tested < verified.

## The tri-model roles

- **Claude = builder.** Scopes, designs, implements, self-checks, and writes the verification evidence.
- **Codex = independent verifier.** Adversarial review with fresh eyes, separate from the author.
  **Blocks the merge** until clean. Codex is a reviewer, not a second author — two perspectives beat
  one perspective twice.
- (A third model may tie-break when builder and verifier disagree.)

### Human approval boundaries

Some actions are **never** taken by an agent autonomously and require explicit human (founder)
approval first:

- Public claims, pricing, or marketing language.
- Anything touching secrets, payouts, settlement, or the economy.
- Publishing a package or deploying to production.
- Deleting files outside an explicitly approved set, or changing governance/this file.

**The founder is the merge gate.** Agents prepare and verify; a human approves the merge. An agent
does not merge its own work past this boundary.

## Definition of Done (the merge gate)

A change is DONE only when **all** are true:

- [ ] **Tests green.** Relevant suite passes (`node run-tests.mjs`). New behavior ships with a new
      assertion, or the PR states why not.
- [ ] **Independent review clean.** Codex (not the author) reviewed it and no unresolved
      high-severity finding remains.
- [ ] **Behavioral check.** The thing was actually run and observed doing what was asked — not merely
      compiled/type-checked.
- [ ] **Evidence attached.** The PR includes the commands run and their results.
- [ ] Docs and status reflect the new reality; the commit message is honest.

## Closing an issue: PR link + evidence required

An issue is closed **only** by a merged PR. To close any issue:

1. The closing comment **must link the PR** that resolves it (`Closes #N` in the PR body).
2. The PR **must include verification evidence**: the commands run and their output (test results,
   the behavioral check, the observed behavior).

No PR link or no evidence → the issue stays open. "Done" with nothing to re-run is not done.

## Workflow: PR + verification evidence

1. Scope → design → implement.
2. Run the tests; capture output.
3. Open a PR. The PR body **must include verification evidence** (the commands and their results) and
   **link the issue** it closes.
4. Independent review (Codex). Security review if the change touches auth, crypto, secrets, channels,
   or any external surface.
5. Merge only when the Definition of Done is fully met and a human has approved. A PR with no evidence
   is not reviewable.

## Secret hygiene

- **Never** read, echo, print, or interpolate `.env`, keys, tokens, or credentials into any output,
  log, commit, or PR.
- **No `bash -x`** (or equivalent tracing) on any script that sources secrets.
- **Never** hand raw tokens to another agent or tool — use a credential helper, not the secret.
- Keep this repo public-safe: no secrets, no private infrastructure details, no internal hostnames or
  IPs, no absolute home paths in committed files.
- Run a secret-scan grep before any commit. Secrets in history are an incident, not a cleanup.

## The alignment gate (apply before building anything)

Before building any feature, ask: *does this increase one of —*

> **intelligence ownership · compounding · portability · sovereignty · execution?**

If the answer is **no**: **stop and re-evaluate.** The feature is likely not aligned with the mission
and probably shouldn't be built.
