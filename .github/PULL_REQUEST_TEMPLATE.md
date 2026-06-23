<!--
Keep this lean. StratosAgent is the execution layer — do not claim production readiness, live
autonomy, settlement/payouts, or ownership-layer features in a PR. State what changed and prove it.
-->

## Summary

<!-- What changed and why, in 2–4 lines. Link the issue: "Closes #N". -->

## Evidence

<!-- Commands you actually ran + their result. For a release, paste:
     node scripts/release-provenance.mjs --json   (or the human verdict line). -->

```
```

## Codex Review Evidence

<!-- REQUIRED. Independent Codex review per the build protocol. Paste the verdict
     (APPROVE / CHANGES) and the key findings, or link the review comment. -->

- Verdict:
- Findings addressed:

## Gemini Validation Evidence

<!-- Tie-breaker / second validation when flagged, or "n/a — no disagreement to break". -->

- Verdict:

## Merge Rationale

<!-- Why this is safe to merge: scope, blast radius, what is NOT touched
     (e.g. no protected-surface diff), and the founder gate if one applies. -->

-

---

- [ ] Tests pass (`node run-tests.mjs`)
- [ ] No secrets / keys / `.env` added or shipped
- [ ] Claims stay honest (execution-layer only; nothing unmeasured asserted)
