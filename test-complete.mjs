/**
 * test-complete.mjs — the `complete` command: a real local completion through the
 * gateway, traced + signed + verified. Hermetic: the gateway is MOCKED (no network),
 * keys are injected, state lands in a temp dir. Proves the wiring end-to-end:
 * route → provider.call → trace → persisted PQC receipt → verify (and eval agrees).
 */
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { run } from "./src/cli/stratos-cli.js";
import { generateHybridKeyPair } from "./src/security/quantum-crypto.js";

let pass = 0;
const ok = (name, cond) => { assert.ok(cond, name); console.log(`  ✓ ${name}`); pass += 1; };
const plain = (r) => r.lines.join("\n").replace(/\x1b\[[0-9;]*m/g, "");

const root = mkdtempSync(path.join(tmpdir(), "stratos-complete-"));
const keyPair = generateHybridKeyPair();
// Same key for signing (trace) and verifying (eval) — the cross-process contract.
const deps = { workspacesRoot: root, traceKeyPair: keyPair, evalPublicKeyBundle: keyPair.publicKey };

// A mock OpenAI-compatible gateway — echoes the prompt, no network.
let sawRequest = null;
const mockFetch = async (url, opts) => {
  const body = JSON.parse(opts.body);
  sawRequest = { url, model: body.model, prompt: body.messages[0].content, stream: body.stream };
  return {
    ok: true,
    async json() {
      return { model: body.model, choices: [{ message: { content: `echo: ${body.messages[0].content}` } }], usage: { total_tokens: 7 } };
    },
  };
};

await run(["workspace", "create", "w"], deps);
await run(["task", "create", "w/p/f/t"], deps);

const r = await run(["complete", "w/p/f/t", "hello sovereign"], { ...deps, fetch: mockFetch });
const text = plain(r);

ok("complete exits 0", r.code === 0);
ok("it POSTed to the gateway with the prompt + non-streaming", sawRequest && sawRequest.prompt === "hello sovereign" && sawRequest.stream === false);
ok("the gateway completion is shown", /echo: hello sovereign/.test(text));
ok("a signed receipt is minted and verifies (public key only)", /receipt .* ✓ verified/.test(text));
ok("the completion is persisted as a task output", existsSync(path.join(root, "w", "p", "f", "t", "outputs", "t.completion.txt")));
ok("the persisted output matches the completion", readFileSync(path.join(root, "w", "p", "f", "t", "outputs", "t.completion.txt"), "utf8").includes("echo: hello sovereign"));

// eval (a separate run) must re-verify the SAME receipt — trace-integrity 6/6.
const e = await run(["eval", "w/p/f/t"], deps);
ok("eval re-verifies the completion's receipt (6/6, trace-integrity)", /6\/6/.test(plain(e)) && /trace-integrity/.test(plain(e)));

// Missing gateway → honest failure, never a fabricated completion/receipt.
const downFetch = async () => { throw new Error("ECONNREFUSED"); };
const f = await run(["complete", "w/p/f/t", "x"], { ...deps, fetch: downFetch });
ok("a down gateway fails closed (non-zero, no fake completion)", f.code !== 0 && /completion failed/.test(plain(f)));

console.log(`\n${pass}/8 checks passed`);
process.exit(0);
