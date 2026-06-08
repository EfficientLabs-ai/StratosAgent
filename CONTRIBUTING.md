# Contributing to StratosAgent

Thanks for your interest in the **publicly-auditable operating core** of StratosAgent. This repository
is deliberately scoped: it holds the engines, formats, verifiers, and interfaces that should be open so
anyone can audit, trust, and build on them. Contributions to that surface are very welcome.

## The one rule: every claim ships with a hermetic test

This project's whole reason to exist is **provable honesty**. So:

- A new behavior or fix lands with a **hermetic test** — no network, no LLM, no external services.
- Tests are plain `node:assert` scripts that **self-report and exit non-zero on failure** (see any
  `test-*.mjs`). They run with `npm test`.
- Determinism is a feature. Capture, trace, and eval must not call a model or the network. Inject any
  clock / key / provider so the test is reproducible.

```sh
npm install
npm test        # all 10 suites must stay green
```

## Scope — what belongs here

✅ In scope (the public operating core):

- the files-first operating core (`workspace`, `context`, `trace`, `eval`, `operating`);
- the capability-receipt **format + verifier** and the public-key bundle path;
- signed-skill / SKILL.md verify-before-run (`skill-seal`, `skill-md`, `skill-store`);
- the capability gate and the post-quantum crypto primitives;
- the model **router + adapter interfaces** and the mesh signal;
- the architecture docs and the honest status matrix.

🚫 Out of scope (private by design — please don't add them here):

- skill-induction / self-improvement **generation** code;
- economic / reward **accounting**;
- private connector / broker internals, credential vaults, or infrastructure;
- private mesh internals (bootstrap topology, operator infra).

If you're unsure whether something is in scope, open an issue first and ask. When in doubt, leave it
out — that's the same rule the maintainers carve by.

## Style

- ES modules, Node ≥ 20, no build step. Keep dependencies minimal — the core ships with a single
  runtime dependency (`@noble/post-quantum`).
- **Deny-by-default** and **fail-closed** are the security posture everywhere. A new capability is
  denied unless explicitly declared; a verification failure is a hard failure, never a silent pass.
- **Never** add a secret, token, private IP, or absolute home/infra path to a tracked file.
- Honesty in comments and docs: describe what the code *does*, not what we wish it did. Mark anything
  aspirational clearly.

## Pull requests

1. Branch from the default branch.
2. Add or update tests; run `npm test` and confirm all suites pass.
3. Keep the diff focused and the commit history meaningful.
4. Describe what you changed and how you verified it.

## License

By contributing, you agree your contribution is licensed under the repository's **Business Source
License 1.1** (which converts to Apache 2.0 on the Change Date). See [`LICENSE`](LICENSE).
