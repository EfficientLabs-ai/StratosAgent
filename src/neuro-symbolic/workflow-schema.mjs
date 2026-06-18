#!/usr/bin/env node
/**
 * workflow-schema.mjs — CODE / WORKFLOW AS DATA (homoiconicity + AST validation) for the
 * neuro-symbolic runtime (System 2).
 *
 * The LLM (System 1) emits workflows and edits as structured data trees (JSON/AST). Before ANY of it
 * reaches a runtime, this layer validates it against a strict schema: a structural/type/allow-list
 * violation is REJECTED deterministically (with a precise path + reason the LLM can auto-correct on),
 * never compiled or executed. This is the "validate generated code as data before execution" gate.
 *
 * Pure, never throws. Node types: seq | parallel | tool | transition | assert.
 *   import { validateWorkflow } from './workflow-schema.mjs'
 *   const { ok, errors } = validateWorkflow(tree, { allowedActions, maxDepth })
 *   node workflow-schema.mjs selftest
 */

export const NODE_TYPES = Object.freeze(['seq', 'parallel', 'tool', 'transition', 'assert']);

export function validateWorkflow(root, opts = {}) {
  const allowedActions = Array.isArray(opts.allowedActions) ? opts.allowedActions : null; // optional allow-list
  const maxDepth = Number.isInteger(opts.maxDepth) ? opts.maxDepth : 64;
  const maxNodes = Number.isInteger(opts.maxNodes) ? opts.maxNodes : 10_000;
  const errors = [];
  let count = 0;
  const err = (p, m) => errors.push(`${p}: ${m}`);

  function walk(n, p, depth) {
    if (++count > maxNodes) { if (count === maxNodes + 1) err('$', `exceeds max nodes ${maxNodes}`); return; }
    if (depth > maxDepth) { err(p, `exceeds max depth ${maxDepth}`); return; }
    if (n === null || typeof n !== 'object' || Array.isArray(n)) { err(p, 'node must be a plain object'); return; }
    if (typeof n.type !== 'string' || !NODE_TYPES.includes(n.type)) {
      err(p, `type must be one of ${NODE_TYPES.join('|')} (got ${JSON.stringify(n.type)})`);
      return;
    }
    switch (n.type) {
      case 'seq':
      case 'parallel':
        if (!Array.isArray(n.children) || n.children.length === 0) { err(p, `${n.type} requires a non-empty children[]`); break; }
        n.children.forEach((c, i) => walk(c, `${p}.children[${i}]`, depth + 1));
        break;
      case 'tool':
        if (typeof n.action !== 'string' || !n.action) err(p, 'tool requires a non-empty string action');
        else if (allowedActions && !allowedActions.includes(n.action)) err(p, `tool action "${n.action}" is not in the allow-list`);
        if (n.args != null && (typeof n.args !== 'object' || Array.isArray(n.args))) err(p, 'tool args, if present, must be a plain object');
        break;
      case 'transition':
        if (typeof n.action !== 'string' || !n.action) err(p, 'transition requires a non-empty string action');
        else if (allowedActions && !allowedActions.includes(n.action)) err(p, `transition action "${n.action}" is not in the allow-list`);
        break;
      case 'assert':
        if (typeof n.expr !== 'string' || !n.expr) err(p, 'assert requires a non-empty string expr');
        break;
    }
  }

  walk(root, '$', 0);
  return { ok: errors.length === 0, errors };
}

// ── hermetic selftest ──
function selftest() {
  let pass = 0, fail = 0;
  const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.error('  ✗', m); } };

  const good = {
    type: 'seq',
    children: [
      { type: 'tool', action: 'fetch.logs', args: { path: '/var/log' } },
      { type: 'parallel', children: [
        { type: 'tool', action: 'scan.errors' },
        { type: 'assert', expr: 'errors == 0' },
      ] },
      { type: 'transition', action: 'deploy' },
    ],
  };
  ok(validateWorkflow(good).ok === true, 'well-formed workflow tree accepted');
  ok(validateWorkflow(good, { allowedActions: ['fetch.logs', 'scan.errors', 'deploy'] }).ok === true, 'allow-listed actions accepted');
  ok(validateWorkflow(good, { allowedActions: ['fetch.logs'] }).ok === false, 'non-allow-listed action rejected');
  ok(validateWorkflow({ type: 'frobnicate', children: [] }).ok === false, 'unknown node type rejected');
  ok(validateWorkflow({ type: 'seq', children: [] }).ok === false, 'empty seq rejected');
  ok(validateWorkflow({ type: 'tool' }).ok === false, 'tool without action rejected');
  ok(validateWorkflow({ type: 'tool', action: 'x', args: [1, 2] }).ok === false, 'tool with non-object args rejected');
  ok(validateWorkflow('rm -rf /').ok === false, 'raw string (not a data tree) rejected');
  ok(validateWorkflow(null).ok === false, 'null rejected (never throws)');
  const deep = (() => { let n = { type: 'tool', action: 'x' }; for (let i = 0; i < 70; i++) n = { type: 'seq', children: [n] }; return n; })();
  ok(validateWorkflow(deep, { maxDepth: 64 }).ok === false, 'over-deep tree rejected (DoS guard)');
  const r = validateWorkflow({ type: 'seq', children: [{ type: 'tool' }] });
  ok(r.errors[0].includes('$.children[0]'), 'error carries a precise path for auto-correction');

  console.log(`\n${fail ? '✖' : '✓'} workflow-schema: ${pass} passed, ${fail} failed`);
  return fail === 0;
}

import { fileURLToPath } from 'node:url';
import path from 'node:path';
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv[2] === 'selftest') process.exit(selftest() ? 0 : 1);
  else { console.error('usage: workflow-schema.mjs selftest'); process.exit(2); }
}
