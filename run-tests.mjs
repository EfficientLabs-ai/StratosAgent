#!/usr/bin/env node
/**
 * run-tests.mjs — cross-platform test runner.
 *
 * The previous `npm test` was a bash `for` loop, which fails on Windows
 * (PowerShell/cmd): "t was unexpected at this time." This runs every
 * `test-*.mjs` suite with the current Node binary on ANY OS, auto-discovering
 * suites (so new tests are picked up without editing package.json), and exits
 * non-zero if any suite fails.
 */
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const suites = readdirSync(here)
  .filter((f) => /^test-.*\.mjs$/.test(f))
  .sort();

if (suites.length === 0) {
  console.error("no test-*.mjs suites found");
  process.exit(1);
}

let failed = 0;
for (const s of suites) {
  process.stdout.write(`\n── ${s} ──\n`);
  const r = spawnSync(process.execPath, [path.join(here, s)], { stdio: "inherit" });
  if (r.status !== 0) failed += 1;
}

const passed = suites.length - failed;
console.log(`\n${passed}/${suites.length} suites passed`);
process.exit(failed ? 1 : 0);
