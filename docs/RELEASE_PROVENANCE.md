# Release provenance

**Goal:** prove that the published npm package, the GitHub commit/tag, the packed tarball, a clean
install, the test suite, and the capability-receipt proof rail **all refer to the same artifact** —
so trust in a `@efficientlabs/stratos` release rests on reproducible evidence, not assertion.

This is scoped deliberately. It proves the **execution artifact is what it says it is.** It claims
nothing about production readiness, live autonomy, settlement, payouts, or ownership-layer features.
StratosAgent is the execution layer; provenance is execution-layer integrity.

## TL;DR

```bash
node scripts/release-provenance.mjs            # full run, human-readable verdict
node scripts/release-provenance.mjs --json     # machine-readable (paste into a PR / receipt)
node scripts/release-provenance.mjs --quick    # skip the slow clean-install + test checks
node scripts/release-provenance.mjs --offline  # skip the npm-registry lookup
```

Exit code is **0** when no check `FAIL`s. `WARN` and `SKIP` are honest states, not failures:
- `WARN` — e.g. a dirty working tree, or the release tag is not at `HEAD` (main has moved on). The
  fact is reported instead of hidden.
- `SKIP` — a check that could not run (no network, or you opted out with a flag). Never a silent pass.

## What it checks

| # | Check | What it proves | Status logic |
|---|-------|----------------|--------------|
| 1 | `node-version` | the runtime meets the `engines.node` floor, parsed live from `package.json` (currently `>=22.22.3 <23`) | FAIL below the floor, or if `engines.node` is missing/unparseable |
| 2 | `package-version` | the version anchor every other check compares to | — |
| 3 | `git-commit` | which commit this is, and whether the tree is clean | WARN if dirty |
| 4 | `git-tag` | tag `v<version>` exists and which commit it points to | WARN if the tag is absent locally **or not at `HEAD`** |
| 5 | `npm-published` | the published `@latest` version equals `package.json` | FAIL on mismatch · SKIP offline |
| 6 | `npm-pack` | the tarball ships only whitelisted files, **no secrets** | FAIL if a key/.env/.pem would ship or the version drifts |
| 7 | `clean-install` | a freshly packed tarball installs and the binary runs | FAIL if install or `stratos --version` is wrong |
| 8 | `tests` | `node run-tests.mjs` is green | FAIL on any failing suite · SKIP with `--quick` |
| 9 | `receipt-flow` | export → verify (**OK**) → tamper → verify (**BROKEN**, fail-closed) | FAIL if a tampered receipt does not fail closed |

## The chain of evidence (why these checks, in this order)

1. **The runtime is supported** (1) — otherwise nothing below is trustworthy.
2. **The version is single-sourced** (2) and the **commit is identifiable and clean** (3).
3. The **release is tagged** (4), so a human can map version → commit.
4. The **registry agrees** (5): what users `npm install` is the version in this repo.
5. The **artifact is honest** (6): the tarball carries exactly the whitelisted source — and provably
   **no private keys, `.env`, or secret material.**
6. That artifact **actually installs and runs** from clean (7).
7. The **behaviour is verified** (8) by the real suite.
8. The product's core trust claim — the receipt rail — **holds and fails closed** (9).

A reviewer who sees `PROVENANCE OK` can state, with reproducible backing, that the published package
corresponds to this commit and behaves as tested.

## Reproduce each line by hand

These are the exact commands the script runs; run them yourself to audit the verdict.

```bash
# (2) version anchor
node -e "console.log(require('./package.json').name + '@' + require('./package.json').version)"

# (3) commit + tree
git rev-parse HEAD && git status --porcelain && git tag --points-at HEAD

# (4) tag → commit
git rev-list -n1 v$(node -p "require('./package.json').version")

# (5) published version (network)
npm view @efficientlabs/stratos@latest version

# (6) pack contents + shasum + secret scan
npm pack --dry-run --json

# (7) clean install from a real tarball
TMP=$(mktemp -d); npm pack --pack-destination "$TMP"
( cd "$TMP" && npm init -y >/dev/null && npm i ./*.tgz --no-audit --no-fund \
  && node node_modules/@efficientlabs/stratos/bin/stratos.js --version )

# (8) tests
node run-tests.mjs

# (9) receipt: export → verify → tamper → fail closed
WS=$(mktemp -d); export STRATOS_WORKSPACES_DIR="$WS/workspaces" STRATOS_NODE_KEYS="$WS/.stratos-profile/node-keys.json"
node bin/stratos.js init demo && node bin/stratos.js task create demo/p/f/t1
node bin/stratos.js capture demo/p/f/t1 "provenance" && node bin/stratos.js trace demo/p/f/t1
R=$(find "$WS" -name '*.receipt.jsonl'); node bin/stratos.js receipt export "$R" --out "$WS/bundle.json"
node bin/stratos.js receipt verify "$WS/bundle.json"     # ✓ OK   (exit 0)
node -e "const f='$WS/bundle.json',b=require(f);b.receipts[0].cost_units=9e9;require('fs').writeFileSync('$WS/t.json',JSON.stringify(b))"
node bin/stratos.js receipt verify "$WS/t.json"; echo "exit=$?"   # ✗ BROKEN (exit 1)
```

## Honest caveats

- **Tarball shasum is informational, not an equality gate.** A fresh `npm pack` is not guaranteed to be
  byte-identical to the originally published tarball across npm versions (tar normalization differs).
  Provenance is therefore proven by the *version triple* (package = tag = registry) plus *contents*
  (whitelist, no secrets) plus *behaviour* (tests, receipt fail-closed) — not by a repacked hash.
- **The release tag may not be at `HEAD`.** On a feature branch or after a post-release merge, `git-tag`
  reports the tag's commit and **WARNs** that it is not at `HEAD` — so a clean `PROVENANCE OK` can never
  silently mean "a different commit was checked." That state is expected day-to-day; to assert "this
  exact commit produced the published package," run the full check at the tagged commit (expect all green).
- **Network checks SKIP, not FAIL, when offline.** Re-run online (or in CI) to exercise `npm-published`.

## When to run it

- Before cutting a release (at the tagged commit) — expect all green.
- In a release PR — paste `--json` output as evidence.
- Any time you need to answer "is what's on npm really this code?"
