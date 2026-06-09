# AGENTS.md — How agents work in this repo

> Governance for AI coding agents (Claude, Codex, and any assistant) contributing here.
> These rules are non-negotiable. If a change can't satisfy them, don't ship it.

## The truth gate (read this first)

**Only tested capability is labeled "done."** If it isn't covered by a passing test and verified to actually run, it is not done — call it WIP, partial, or planned.

- **Mocks are labeled `mock`/`stub`/`fake`** in code, comments, and docs. A mock is never described as a working feature.
- **No inflated status.** READMEs, changelogs, and PR descriptions describe what *is*, not what is hoped. Aspiration is labeled as aspiration.
- Verify against reality before claiming a result. If you didn't run it, say so.

## Definition of Done (the merge gate)

A change is DONE only when **all** are true:

- [ ] **Tests green.** Relevant suite passes (`node run-tests.mjs`). New behavior ships with a new assertion, or the PR states why not.
- [ ] **Independent review clean.** A second agent/reviewer (not the author) reviewed it and no unresolved high-severity finding remains.
- [ ] **Behavioral check.** The thing was actually run and observed doing what was asked — not merely compiled/type-checked.
- [ ] Docs and status reflect the new reality; the commit message is honest.

## Roles

- **Claude = builder.** Scopes, designs, implements, self-checks.
- **Codex = verifier.** Independent, adversarial review with fresh eyes. **Blocks the merge** until green. Codex is a reviewer, not a second author — two perspectives beat one perspective twice.

## Workflow: PR + verification evidence

1. Scope → design → implement.
2. Run the tests; capture output.
3. Open a PR. The PR body **must include verification evidence**: the commands run and their results (test output, the behavioral check, the endpoint hit / observed behavior).
4. Independent review (Codex). Security review if the change touches auth, crypto, secrets, channels, or any external surface.
5. Merge only when the Definition of Done is fully met. A PR with no evidence is not reviewable.

## Secret hygiene

- **Never** read, echo, print, or interpolate `.env`, keys, tokens, or credentials into any output, log, commit, or PR.
- **No `bash -x`** (or equivalent tracing) on any script that sources secrets.
- **Never** hand raw tokens to another agent or tool — use a credential helper, not the secret.
- Run a secret-scan grep before any commit. Secrets in history are an incident, not a cleanup.

## The alignment gate (apply before building anything)

Before building any feature, ask: *does this increase one of —*

> **intelligence ownership · compounding · portability · sovereignty · execution?**

If the answer is **no**: **stop and re-evaluate.** The feature is likely not aligned with the mission and probably shouldn't be built.
