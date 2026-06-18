#!/usr/bin/env node
/**
 * graph-query.mjs — the RELATIONAL LAYER (the "inference half") of the neuro-symbolic runtime.
 *
 * A typed knowledge graph (subject–predicate–object triples) that answers EXACT, deterministic
 * relational questions embeddings cannot: "does A depend on B?", "what order must these deploy in?".
 * The HYBRID retrieval loop is the point: a vector/semantic scorer finds INTENT (which nodes the
 * fuzzy query is about), then a STRICT graph traversal returns the precise relational subgraph. The
 * scorer is INJECTABLE (default = deterministic lexical overlap) so a real embedder plugs in without
 * touching the graph logic. Pure, deterministic, never throws.
 *
 *   import { createGraph, hybridRetrieve } from './graph-query.mjs'
 *   node graph-query.mjs selftest
 */

export function createGraph(triples = []) {
  const T = [];
  const add = (s, p, o) => { if ([s, p, o].every((x) => typeof x === 'string' && x)) T.push({ s, p, o }); };
  for (const t of triples) add(t.s ?? t[0], t.p ?? t[1], t.o ?? t[2]);

  /** match({s?,p?,o?}) — undefined fields are wildcards. */
  const match = ({ s, p, o } = {}) => T.filter((t) => (s == null || t.s === s) && (p == null || t.p === p) && (o == null || t.o === o));
  const out = (node, p) => match({ s: node, p }).map((t) => t.o);
  const inc = (node, p) => match({ o: node, p }).map((t) => t.s);
  const nodes = () => [...new Set(T.flatMap((t) => [t.s, t.o]))];

  /** Multi-hop reachability over a predicate: does `a` (transitively) depend on `b`? */
  function dependsOn(a, b, pred = 'depends_on', maxHops = 64) {
    const seen = new Set([a]);
    let frontier = [a], hops = 0;
    while (frontier.length && hops++ < maxHops) {
      const next = [];
      for (const n of frontier) for (const m of out(n, pred)) {
        if (m === b) return true;
        if (!seen.has(m)) { seen.add(m); next.push(m); }
      }
      frontier = next;
    }
    return false;
  }

  /** Deterministic topological order over `pred` (e.g. "Service A must deploy before Service B").
   *  Returns { order:[...], cycle:bool }. Stable: ties broken by input/lexical order. */
  function order(items, pred = 'depends_on') {
    const set = [...new Set(items && items.length ? items : nodes())]; // dedupe — duplicate inputs must not fake a cycle
    const inSet = new Set(set);
    const deps = new Map(set.map((n) => [n, out(n, pred).filter((d) => inSet.has(d))]));
    const result = [], done = new Set();
    let progress = true;
    while (result.length < set.length && progress) {
      progress = false;
      for (const n of [...set].sort()) {
        if (done.has(n)) continue;
        if (deps.get(n).every((d) => done.has(d))) { result.push(n); done.add(n); progress = true; }
      }
    }
    return { order: result, cycle: result.length < set.length };
  }

  return { add, match, out, inc, nodes, dependsOn, order, triples: () => [...T] };
}

/** Default semantic scorer: deterministic token-overlap (Jaccard). Stand-in for a real embedder. */
function lexical(query, label) {
  const tok = (s) => new Set(String(s).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  const a = tok(query), b = tok(label);
  if (!a.size || !b.size) return 0;
  let inter = 0; for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/**
 * HYBRID retrieve: vector/semantic seed → strict graph expansion.
 * @param graph   createGraph() instance
 * @param query   fuzzy natural-language intent
 * @param opts.embed (query,label)->score[0..1]  injectable scorer (default lexical)
 * @param opts.topK  seeds to keep · opts.hops graph-expansion depth · opts.expandPred predicate to expand
 * Returns { seeds:[{n,score}], nodes:[...], subgraph:[triples] } — the precise relational map for context.
 */
export function hybridRetrieve(graph, query, opts = {}) {
  const score = typeof opts.embed === 'function' ? opts.embed : lexical;
  const topK = Number.isInteger(opts.topK) ? opts.topK : 3;
  const hops = Number.isInteger(opts.hops) ? opts.hops : 1;
  const seeds = graph.nodes()
    .map((n) => ({ n, score: score(query, n) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.n.localeCompare(b.n))
    .slice(0, topK);
  const keep = new Set(seeds.map((s) => s.n));
  let frontier = [...keep];
  for (let h = 0; h < hops; h++) {
    const next = [];
    for (const n of frontier) for (const m of graph.out(n, opts.expandPred)) if (!keep.has(m)) { keep.add(m); next.push(m); }
    frontier = next;
  }
  return { seeds, nodes: [...keep], subgraph: graph.triples().filter((t) => keep.has(t.s) && keep.has(t.o)) };
}

// ── hermetic selftest ──
function selftest() {
  let pass = 0, fail = 0;
  const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.error('  ✗', m); } };

  const g = createGraph([
    ['api', 'depends_on', 'auth'],
    ['auth', 'depends_on', 'database'],
    ['web', 'depends_on', 'api'],
    ['api', 'type', 'service'],
    ['database', 'type', 'datastore'],
  ]);

  ok(g.match({ p: 'depends_on' }).length === 3, 'wildcard match returns all depends_on edges');
  ok(JSON.stringify(g.out('api', 'depends_on')) === '["auth"]', 'out() returns typed neighbors');
  ok(g.dependsOn('web', 'database') === true, 'multi-hop dependency found (web→api→auth→database)');
  ok(g.dependsOn('database', 'web') === false, 'no false dependency (database does not depend on web)');
  const ord = g.order(['web', 'api', 'auth', 'database']);
  ok(!ord.cycle && ord.order.indexOf('database') < ord.order.indexOf('auth') && ord.order.indexOf('auth') < ord.order.indexOf('api') && ord.order.indexOf('api') < ord.order.indexOf('web'), 'topo order: dependency must come before dependent');
  const cyc = createGraph([['x', 'depends_on', 'y'], ['y', 'depends_on', 'x']]).order(['x', 'y']);
  ok(cyc.cycle === true, 'cycle detected deterministically');
  ok(g.order(['api', 'api', 'auth', 'database']).cycle === false, 'duplicate inputs deduped — no false cycle (audit fix)');
  const hrDefault = hybridRetrieve(g, 'api', { topK: 1, hops: 1 });
  ok(hrDefault.nodes.includes('auth') && hrDefault.nodes.includes('service'), 'default hybridRetrieve expands across ALL out predicates');

  // the hybrid loop: a fuzzy query seeds the graph, expansion returns the precise relational subgraph
  const r = hybridRetrieve(g, 'what does the web frontend need', { topK: 1, hops: 8, expandPred: 'depends_on' });
  ok(r.seeds[0].n === 'web', 'vector/semantic seed picks the intended node from a fuzzy query');
  ok(['web', 'api', 'auth', 'database'].every((n) => r.nodes.includes(n)), 'graph expansion returns the exact transitive dependency set');
  // injectable embedder: a real embedder can override scoring without touching graph logic
  const r2 = hybridRetrieve(g, 'irrelevant', { embed: (_q, n) => (n === 'database' ? 1 : 0), topK: 1, hops: 0 });
  ok(r2.seeds[0].n === 'database', 'injectable scorer overrides the default (real embedder plugs in)');

  console.log(`\n${fail ? '✖' : '✓'} graph-query: ${pass} passed, ${fail} failed`);
  return fail === 0;
}

import { fileURLToPath } from 'node:url';
import path from 'node:path';
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv[2] === 'selftest') process.exit(selftest() ? 0 : 1);
  else { console.error('usage: graph-query.mjs selftest'); process.exit(2); }
}
