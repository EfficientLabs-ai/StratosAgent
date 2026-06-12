# ARCHITECTURE AUDIT — `StratosAgent` (public)

> **Repo:** `EfficientLabs-ai/StratosAgent` — npm package `@efficientlabs/stratos` **v1.1.0**, BSL 1.1. The **publicly-auditable operating core** of a sovereign, local-first AI agent: a carved subset of the private `atmosphere-core/packages/stratos-agent`, with the proprietary learning/economic flywheel and connector/broker internals deliberately removed.
> **Method:** read-only inspection of `main` (`322faac`) by two parallel exploration passes; every claim cites `path:line`. Secret files never read (`.stratos-profile/node-keys.json` confirmed gitignored + untracked).
> **Key framing:** in a public-carve audit, the important distinction is **wired** vs **stub** vs **private-by-design seam** (an interface/contract present here whose implementation lives only in the private repo). "Missing" is split accordingly in §12.

---

## 1. Current Folder Structure

```
StratosAgent/                          @efficientlabs/stratos v1.1.0 · ESM · 1 dep (@noble/post-quantum)
├── bin/stratos.js                     811B   public CLI entry (thin wrapper → run())
├── src/
│   ├── cli/stratos-cli.js             37.8K  ← largest; the whole command surface (12 commands)
│   ├── context/
│   │   ├── context-capture.js          9.1K  capture→classify→store (deterministic, no LLM)
│   │   └── icm-workspace.js            6.1K  L0–L4 "folders over agents" scaffold (L2+L4 live)
│   ├── eval/eval-engine.js            21.6K  5-criterion deterministic rubric + lesson seam
│   ├── ledger/capability-receipt.js   17.5K  PQC-signed hash-chained JSONL receipt + verifier
│   ├── memory/skill-seal.js            3.7K  hybrid-PQC skill-block seal/verify + originId
│   ├── operating/operating-tap.js      9.1K  flag-gated, default-OFF observational tap
│   ├── routing/
│   │   ├── mesh-signal.js              4.0K  honest file-backed mesh availability (no transport)
│   │   ├── model-adapter.js           11.0K  Privacy>Capability>Cost>Fallback seam (no provider bundled)
│   │   └── model-router.js             5.0K  tier decision (local-default)
│   ├── security/
│   │   ├── capability-gate.js          5.5K  deny-by-default least-privilege gate
│   │   └── quantum-crypto.js           6.7K  X25519+ML-KEM-768 / Ed25519+ML-DSA-65 (real PQC)
│   ├── skills/
│   │   ├── skill-md.js                17.1K  SKILL.md import/export portability (untrusted-by-default)
│   │   └── skill-store.js              2.0K  file-backed index for imported skills
│   ├── trace/trace-engine.js          11.1K  start→steps→end + receipt minting
│   └── workspace/workspace-tree.js    12.7K  Workspace>Project>Workflow>Task tree
├── 11 × test-*.mjs + run-tests.mjs    auto-discovering hermetic runner
├── .github/workflows/ci.yml           3-OS × Node 20/22 matrix + end-to-end operating-loop smoke
├── .stratos-profile/node-keys.json    runtime node identity (gitignored, NOT tracked)
├── assets/ (hero.png, agent.png ~1.9MB each)
└── ARCHITECTURE.md CONTEXT_ROUTING.md MODEL_ROUTING.md SELF_IMPROVEMENT_LOOP.md
    STATE_OF_REALITY.md TRACE_SCHEMA.md README.md CONTRIBUTING.md LICENSE(BUSL-1.1)
```

The `exports` map (`package.json:16-29`) is the library surface (12 subpaths: `./cli ./workspace ./context ./trace ./eval ./receipt ./skill-seal ./skill-md ./router ./adapter ./capability-gate ./crypto`); `bin.stratos` is the CLI. **No SQLite, no LanceDB, no `node_modules`-vendored providers** — the only dependency is `@noble/post-quantum`.

---

## 2. Current Responsibilities

| Unit | Export | Responsibility |
|---|---|---|
| `bin/stratos.js` | bin | CLI entry: runs `run(argv)`, prints lines, exits with code; no network/telemetry |
| `src/cli/stratos-cli.js` | `./cli` | `run(argv, deps)` dispatching `init·workspace·task·capture·complete·trace·eval·skill·route·receipt·version·help`; fully dependency-injectable |
| `src/workspace/workspace-tree.js` | `./workspace` | files-first `Workspace>Project>Workflow>Task` tree; scaffolds the canonical task entries; path-traversal-safe |
| `src/context/context-capture.js` | `./context` | `capture()`/`classify()` deterministic capture→classify→store; no LLM/embeddings |
| `src/context/icm-workspace.js` | (internal) | scaffold/validate L0–L4 ICM workspace (L2/L4 live) |
| `src/trace/trace-engine.js` | `./trace` | `startTrace/recordStep/endTrace`; hashes step I/O (never stored); mints receipt on end |
| `src/eval/eval-engine.js` | `./eval` | `evaluate()` deterministic rubric scorecard + candidate lessons |
| `src/ledger/capability-receipt.js` | `./receipt` | `ReceiptLog`, signer/verifier, `verifyBundle`, `summarize()` (cost measured, never priced) |
| `src/memory/skill-seal.js` | `./skill-seal` | `originId`, `sealSkillBlock`, `verifySkillBlock` (hybrid PQC) |
| `src/skills/skill-md.js` | `./skill-md` | SKILL.md parse/emit/import/export; foreign `.md` = untrusted, inert |
| `src/skills/skill-store.js` | (internal) | file-backed JSON index for imported skills (separate from sealed) |
| `src/routing/model-router.js` | `./router` | `route()` tier decision + transparent `difficulty()` heuristic |
| `src/routing/model-adapter.js` | `./adapter` | provider-precedence seam; real call lives in injected provider's `call()` |
| `src/routing/mesh-signal.js` | (internal) | `meshAvailable()` honest fleet.json reader (deny-by-default) |
| `src/security/capability-gate.js` | `./capability-gate` | `parseCapabilities/assertStepAllowed/deriveCapabilities` |
| `src/security/quantum-crypto.js` | `./crypto` | hybrid PQC keygen/sign/verify/encapsulate/decapsulate |
| `src/operating/operating-tap.js` | (internal) | `observe({meta,exec})` default-OFF integration point |

---

## 3. Existing Systems

| System | Path | Status |
|---|---|---|
| Files-first operating tree | `workspace-tree.js` | **Wired** — 8-entry task scaffold, traversal-safe |
| Deterministic context capture | `context-capture.js` | **Wired** — no LLM/network; summarizer off-by-default |
| ICM L0–L4 workspace | `icm-workspace.js` | **Partial** — L2/L4 live (`:27-33`); L0/L1/L3 scaffold; the consuming `engine.js` is **private** |
| Trace engine + receipt spine | `trace-engine.js` | **Wired** — receipt minted on `endTrace`, fail-open |
| Capability-receipt ledger | `ledger/capability-receipt.js` | **Wired** — append-only hash-chain, public-key-only `verifyBundle`, attribution measured-not-priced |
| Capability gate | `security/capability-gate.js` | **Wired** — deny-by-default, enforced on every state-changing CLI command |
| Hybrid PQC crypto | `security/quantum-crypto.js` | **Wired (real)** — X25519+ML-KEM-768 / Ed25519+ML-DSA-65, both halves must verify |
| Skill seal / SKILL.md portability | `skill-seal.js`, `skill-md.js`, `skill-store.js` | **Wired** — seal verify fail-closed; import untrusted-by-default |
| Model router | `routing/model-router.js` | **Wired (decision only)** — no model actually called here |
| Model adapter seam | `routing/model-adapter.js` | **Wired (decision)** / **private-seam (call)** — provider injected |
| Mesh signal | `routing/mesh-signal.js` | **Stub-honest** — false until a real `fleet.json`; **no transport** (lives in TheAtmosphere) |
| `complete` (real inference) | `cli/stratos-cli.js:572-666` | **Wired to a gateway YOU provide** (`:38` default `127.0.0.1:4099`); no gateway bundled |
| Operating-tap | `operating/operating-tap.js` | **Wired but DEFAULT-OFF** (`STRATOS_OPERATING_CORE==='1'`) |
| Reward/economic accounting | — | **Private-by-design (absent)** — receipt carries wallet attribution but no payout/settlement |
| Skill-induction / self-improvement generator | — | **Private-by-design (absent)** — only the lesson seam ships |

---

## 4. Existing Harness Components

The operating core is a 5-increment `workspace→context→trace→eval` loop; **all legs present and tested** (`node run-tests.mjs` → **11/11 suites pass**; CI also runs an end-to-end `workspace→task→capture→trace→eval` smoke on 3 OSes, `ci.yml:25-33`).

- **STORE** — `workspace-tree.js`: deny-by-default task validity (an incomplete folder isn't a valid task, `:201-231`).
- **CAPTURE/CLASSIFY** — `context-capture.js`: deterministic rule-based classifier (`:45-71`).
- **TRACE** — `trace-engine.js`: step I/O hashed-never-stored (`:102`); mints the receipt spine on `endTrace`. *Stale comment:* header + `:65` still call `eval_path` a "TARGET hook... eval-engine not built here" — but eval-engine exists and populates it (`eval-engine.js:389-395`). Functionally correct; comment is out of date.
- **EVALUATE** — `eval-engine.js`: 5-criterion deterministic rubric; `trace-integrity:121` is verify-as-a-criterion, fail-closed; emits one candidate lesson per failed criterion. LLM judge off-by-default.
- **Live-path integration** — `operating-tap.js`: default-OFF, fail-open, lazy-imports the core.
- **CLI** — `run()` returns `{code, lines}`, fully dependency-injectable. The `complete` command is the **only** place a real network call happens, and only to an operator-supplied gateway.
- **Cross-process proof** — `loadOrCreateNodeKeys` persists a stable keypair so a later `eval` run verifies the earlier run's receipt with the public key alone (`stratos-cli.js:387-411`).
- **Test harness** — `run-tests.mjs` auto-discovers `test-*.mjs`, runs each under the current Node, non-zero on any failure.

**Self-improve generator: NOT here** — only the lesson-emission seam (`SELF_IMPROVEMENT_LOOP.md:58-72`).

---

## 5. Existing Context Systems

- `context-capture.js` — live, deterministic source-normalizer + keyword intent bucketer. **No RAG, no embeddings, no vector store anywhere** in the repo.
- `icm-workspace.js` — L2 `stages/` + L4 `artifacts/` live (`:30,32`); L0/L1/L3 scaffold-only; the stage-executing `engine.js` is private. Contract+validation only here.
- `CONTEXT_ROUTING.md` — **current, not stale** (unlike the private core's copy); every stage cites shipping code. One nuance: the 4-way `Privacy>Capability>Cost>Fallback` precedence is implemented in `model-adapter.js:99-160`, while `model-router.js` implements the tier policy — both accurate to their files.
- Routing — `route()` deterministic, explains "why"; the call is a provider seam.

---

## 6. Existing Memory Systems

Persistence in this public repo is **plain files only — no database**:
- **Capability-receipt ledger** — append-only JSONL hash-chain `.receipt.jsonl` beside each trace (`stratos-cli.js:347`); hybrid-PQC-signed.
- **Trace/eval records** — `traces/{id}.json`, `evals/{id}.{md,json}` per task.
- **Context records** — `memory/{id}.json` + workspace `session.log` (JSONL index).
- **skill-store** — JSON index for imported skills under `<skillsDir>/imported/`, kept separate so a foreign skill can't masquerade as sealed.
- **`.stratos-profile/node-keys.json`** — runtime hybrid keypair, 0600, **gitignored + untracked** (verified).

**Absent by design (in the private core, not this mirror):** no SQLite, no LanceDB/vector store, no skill-induction memory, no economic/reward ledger, no connector/broker credential store. The public **format + verifier** (the receipt) ships so the private store's outputs stay third-party-auditable.

---

## 7. Existing Agent Systems

This is an **operating core, not an autonomous agent runtime** — no loop, scheduler, or executor.
- **operating-tap.js** — the only live-path wiring; default-OFF (`STRATOS_OPERATING_CORE==='1'`, `:25`), purely observational (capture→trace→optional eval), structurally incapable of altering routing/response (`:19-21`), fail-open. Tested (`test-operating-tap.mjs`).
- **Routing** — `model-router.js` (local-default, cloud opt-in behind `STRATOS_CLOUD_AUTO_ESCALATE`), `model-adapter.js` (provider seam), `mesh-signal.js` (never invents peers; comment: "no device has ever actually connected", `:10-11`).
- **Referenced but NOT present (private-only, confirmed by absent imports + explicit docs):** self-evolution/skill-induction generator (L1), economic/reward accounting (L0), private connectors/broker incl. MCP bridges, night-shift, omni-gateway/channel adapters. The CLI header states it plainly (`stratos-cli.js:6-9`).

---

## 8. Existing Tool Systems

- **skill-md.js** — SKILL.md portability; foreign `.md` is `trust:"untrusted"`, never auto-run; only inert `SAFE_IMPORT_ACTIONS` (read-only) grantable; net/fs/secrets/compute always refused; provenance recorded as claimed/unverified. Tested (74 asserts).
- **skill-seal.js** — hybrid-PQC seal binding skillId+wasmHash+metadata; `verifySkillBlock` fail-closed against a pinned origin. *Seam:* `P2pSkillSync.getSynchronizedSkills()` (the caller that *should* filter through it) is **not in this repo**.
- **skill-store.js** — dependency-free file index for imported skills, separate from sealed.
- **capability-gate.js** — deny-by-default least-privilege: action allowlist + net host allowlist + fs path-prefix (anti-traversal `startsWith(prefix+'/')`, `:70`) + secret-name scope; caps are seal-covered so editing them breaks verification. Tested (21 asserts, traversal proven).
- **quantum-crypto.js** — the **real** hybrid suite: X25519+ML-KEM-768 (HKDF-SHA256 combine) + Ed25519+ML-DSA-65 (both must verify, fail-closed), `@noble/post-quantum` FIPS 203/204. *Minor debt:* 3 `console.warn/error` leak to stderr on verify failure (`:144,156,162`).

**No WASI/exec sandbox here** — the seal binds a `wasmHash` and the gate has a `compute` flag, but the WASM **instantiation/execution engine is private** (`SkillExecutor`/`verifyWasmSkill` referenced, `capability-gate.js:5-7`, not present). This repo ships declaration+verification contracts only.

---

## 9. Existing MCP Integrations

**Essentially none.** A whole-repo search for MCP server/client/JSON-RPC/stdio/"codex" returns nothing. `mcp` exists only as a **string label**: a context-event source (`context-capture.js:25`, `stratos-cli.js:282`, asserted in `test-operating-core.mjs:128`) and an aspirational `/mcp registry` comment for a per-task tool manifest (`workspace-tree.js:144`, marked TARGET, deny-by-default empty manifest). MCP/process bridges are explicitly in the private build (`STATE_OF_REALITY.md:66`). None of the 12 package exports is MCP-related.

---

## 10. Existing Automation Systems

- **`.github/workflows/ci.yml`** — push/PR/`workflow_dispatch`; matrix `{ubuntu,windows,macos}×{20,22}`, `fail-fast:false`; `npm install` → `npm test` → end-to-end operating-loop smoke on every OS.
- **`run-tests.mjs`** — cross-platform auto-discovering runner (replaced a Windows-breaking bash loop); picks up new `test-*.mjs` without editing package.json; non-zero on any failure. 11 suites on disk; `test-complete.mjs` is the only network test and it **mocks fetch**.
- **package.json scripts** — `test`→`run-tests.mjs`, `demo`→`stratos route`. No prepublish/prepare/postinstall.
- **Publish** — published npm package; `engines.node ">=20.19.0"` (just corrected from `>=20`, commit `322faac`); `files` whitelist `["src/","bin/","docs/","*.md","LICENSE"]` (**`docs/` is whitelisted but doesn't exist on disk** — stale). One dep `@noble/post-quantum ^0.6.1`. **No release/publish workflow** — npm publish is manual.

---

## 11. Existing Governance Systems

- **LICENSE** — BSL 1.1; Licensor Efficient Labs; Change Date **2030-05-29** → Apache 2.0; production use only within Atmosphere/StratosAgent; §4 reserves rights in private components (the legal articulation of the carve); notes forked Holepunch components retain their own licenses. *(Minor: `package.json` SPDX `"BUSL-1.1"` vs prose "BSL 1.1" — same license, two conventions.)*
- **STATE_OF_REALITY.md** — three-tier legend (✅ WORKING / 🟡 PARTIAL / 🔒 NOT IN THIS REPO) + the README **L0–L5 matrix**: L5 = hermetic-test-verified; calling a model L2; self-improvement L1; mesh runtime / economic accounting L0.
- **CONTRIBUTING.md** — one rule: "every claim ships with a hermetic test"; explicit in-scope vs private-out-of-scope; deny-by-default/fail-closed style; never commit a secret/private path.
- **README honesty** — "Don't trust it — verify it" (`:24`); footer "claim no capability we can't measure" (`:232`).
- **Capability-gate governance** — enforced in code, not just documented; seal makes the caps declaration tamper-evident.
- **No AGENTS.md** — governance lives in STATE_OF_REALITY + CONTRIBUTING + the L0–L5 matrix. *(An `AGENTS.md` governance doc is the subject of open PR #5.)*

---

## 12. Missing Components

**(A) Missing-by-design — private seams (correctly absent; documented):**
1. Self-improvement / skill-induction **generator** (only the lesson seam ships) — L1.
2. Economic / reward **accounting + settlement** (receipt measures cost, never values it) — L0.
3. Private **connectors / broker / MCP-process bridges**.
4. **WASM/WASI execution engine** — `wasmHash`/`compute` are declared + seal-covered but nothing here runs a skill (`SkillExecutor` is private).
5. **Live model provider** — `model-adapter` is a seam; no provider bundled (you supply Ollama or your own cloud provider gateway) — L2.
6. **Mesh transport** — `mesh-signal` reads state but the DHT runtime lives in TheAtmosphere — L0 here.
7. No RAG / vector / SQLite memory (the rich persistence is private).

**(B) Genuinely incomplete (in-scope gaps to close):**
8. **Dangling verifier** — `verifySkillBlock` has no in-repo caller; `P2pSkillSync` is private, so the public mirror can't demonstrate end-to-end signed-skill sync.
9. **ICM L0/L1/L3** are scaffold folders with no executor here (L2/L4 only).
10. **Thin test coverage** on `test-complete.mjs`, `test-mesh-signal.mjs`, `test-skill-seal.mjs` (2 asserts each); `quantum-crypto.js` has **no dedicated suite** (only exercised via skill-seal).
11. **No `AGENTS.md`, no release/provenance automation** (manual npm publish, no lockfile-verified publish).

---

## 13. Duplicate Components

1. **`quantum-crypto.js` is byte-identical (6,744 B) across StratosAgent and TheAtmosphere/node-runner** — the same PQC primitive carved into both public repos (and the private core). A shared source-of-truth (or a tiny published `@efficientlabs/atmos-crypto`) would prevent three copies drifting.
2. **Whole-repo duplication of the private core** — this mirror is a carve of `atmosphere-core/packages/stratos-agent`; the carved files must be kept in sync with their private originals (drift risk is structural, not a within-repo dup).
3. **`stratos-cli.js` monolith** (719 lines) bundles 12 command handlers + ANSI art + the only network path — a single file doing many jobs.
4. Doc artifacts (`ARCHITECTURE.md`, `CONTEXT_ROUTING.md`, `MODEL_ROUTING.md`, etc.) mirror the private core's same-named docs.

---

## 14. Technical Debt

- **No TODO/FIXME/HACK markers** in tracked source (grep clean); the "mock/stub" hits are legitimate test doubles (`test-complete.mjs:3,23-39`).
- **Doc count inconsistency (real):** README claims "145 hermetic assertions across 11 suites" + a `tests-145` badge, while STATE_OF_REALITY.md says "10 suites" twice; disk has **11** test files and "145" isn't derivable from the source — reconcile.
- **Stale `files` whitelist** — ships `"docs/"` with no `docs/` dir (already addressed by open PR #6, EFL-016).
- **Stale `trace-engine.js` comment** — says eval-engine "not built here" though it exists.
- **`console.*` leakage** in `quantum-crypto.js` verify-failure paths (`:144,156,162`) — a library primitive printing to stderr.
- **Dangling private-module references** (documented seams, won't break in-repo): `skill-seal.js:13` → `P2pSkillSync`; `capability-gate.js:5-7` → `SkillExecutor`/`verifyWasmSkill`; `workspace-tree.js:144` → `/mcp registry`.
- **Largest file** `stratos-cli.js` (719L) — split candidate.
- **Thinnest-tested surfaces:** network-completion, mesh-signal, PQC seal (2 asserts each); no dedicated crypto suite.
- **No SPDX/lockfile publish provenance** (release-provenance is the subject of open work, EFL-016 area).
- **Docs↔code otherwise accurate** — ARCHITECTURE/CONTEXT_ROUTING/MODEL_ROUTING all cite real, matching files. Node key file checked: gitignored + untracked, no secret leak.

---

## 15. Recommendations

*(Remediation of what exists — no new architecture.)*

**P1 — honesty/consistency (cheap, high-trust-value)**
1. **Reconcile the test counts** across README badge / STATE_OF_REALITY / L0–L5 table to the actual 11 suites; either compute the real assertion total or drop the "145" claim.
2. Fix the **stale `trace-engine.js` comment** (eval-engine exists) and remove **`docs/` from the `files` whitelist** (PR #6 covers this).
3. Land the **`AGENTS.md` governance** doc (PR #5).

**P2 — close in-scope gaps**
4. **Thicken the thin suites** (completion path, mesh-signal, skill-seal) and add a **dedicated `quantum-crypto` test** (KEM + sign/verify + tamper).
5. **Suppress `console.*` in `quantum-crypto.js`** (return reasons / inject a logger) so a library primitive doesn't write to stderr.
6. When the private `P2pSkillSync` lands a public demo, **route it through `verifySkillBlock`** so the signed-skill-sync claim is end-to-end demonstrable here.

**P3 — structure & supply chain**
7. **Extract the shared PQC primitive** to one source (or a tiny published package) consumed by StratosAgent + TheAtmosphere + the private core, ending the 3-way `quantum-crypto.js` copy.
8. **Split `stratos-cli.js`** per-subcommand.
9. Add **release provenance** (lockfile-verified publish / npm provenance) for the published `@efficientlabs/stratos`.

---

*End of audit. Reflects `main` at `322faac`. No code modified; runtime key file inspected for tracking status only, never read.*
