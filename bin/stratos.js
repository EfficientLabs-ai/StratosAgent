#!/usr/bin/env node
/**
 * bin/stratos.js — the public `stratos` entrypoint.
 *
 * Thin, honest wrapper around the publicly-auditable CLI core (src/cli/stratos-cli.js). It runs the
 * command, prints the returned lines, and exits with the returned code. No hidden side effects, no
 * telemetry, no network — the testable commands are deterministic by design.
 */
import { run } from '../src/cli/stratos-cli.js';

const argv = process.argv.slice(2);
const { code, lines } = await run(argv);
for (const line of (lines || [])) console.log(line);
process.exit(code ?? 0);
