#!/usr/bin/env node
/**
 * bin/stratos.js — the public `stratos` entrypoint.
 *
 * Thin, honest wrapper around the publicly-auditable CLI core (src/cli/stratos-cli.js). It runs the
 * command, prints the returned lines, and exits with the returned code. No hidden side effects, no
 * telemetry, no network — the testable commands are deterministic by design.
 */
import { createRequire } from 'node:module';
import { run } from '../src/cli/stratos-cli.js';

// Single-source the version from package.json so `stratos --version` never drifts.
const require = createRequire(import.meta.url);
const { version } = require('../package.json');

const argv = process.argv.slice(2);
const { code, lines } = await run(argv, { version });
for (const line of (lines || [])) console.log(line);
process.exit(code ?? 0);
