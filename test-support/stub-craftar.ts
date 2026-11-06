// A stub `craftar` for tests (spec 60 §15): a copy of node named `craftar`, with a preload that records
// each call (its argv and CRAFTAR_HOME) and answers from a table keyed by the leading arguments. No test
// starts the person's own craftar. Node resolves its first argument to an absolute script path before a
// preload runs, so the preload reads it back with basename (craftar-cli's fake-git does the same).
// `craftar mcp` is answered line by line on stdin: initialize from the table's `mcp initialize`, each
// tools/call from `mcp call <n>` (n counted across every mcp child of the test, so a restarted child
// gets the next answer). Each request line is recorded with the argv of the child that received it.
import { chmodSync, copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tempDir } from './tmp'

export interface Answer {
  stdout: string
  code: number
  stderr?: string
  delayMs?: number
}

export interface Call {
  argv: string[]
  home: string | null
  pid: number
  start?: number
  end?: number
  request?: { method: string; params?: unknown; id?: number }
}

export interface StubCraftar {
  bin: string
  env: NodeJS.ProcessEnv
  calls: () => Call[]
  requests: () => Call[]
  spans: () => { argv: string[]; start: number; end: number }[]
}

const HOOK = `"use strict";
const fs = require("fs");
const path = require("path");
if (path.basename(process.execPath).toLowerCase().replace(/\\.exe$/, "") === "craftar") {
  const argv = process.argv.slice(1);
  if (argv[0]) argv[0] = path.basename(argv[0]);
  const log = process.env.CRAFTAR_STUB_LOG;
  const record = (extra) => fs.appendFileSync(log, JSON.stringify({ argv, home: process.env.CRAFTAR_HOME ?? null, pid: process.pid, ...extra }) + "\\n");
  const table = JSON.parse(fs.readFileSync(process.env.CRAFTAR_STUB_TABLE, "utf8"));
  record({ start: Date.now() });
  if (argv[0] === "mcp") {
    // Node goes on to load argv[1] as its main script, which does not exist: keep the process serving.
    process.on("uncaughtException", (e) => {
      if (e && e.code === "MODULE_NOT_FOUND") return;
      process.stderr.write(String(e));
      process.exit(70);
    });
    let buf = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf("\\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        const req = JSON.parse(line);
        const calls = fs.readFileSync(log, "utf8").split("\\n").filter((l) => l && JSON.parse(l).request?.method === "tools/call").length;
        record({ request: req });
        if (req.id === undefined) continue;
        const key = req.method === "initialize" ? "mcp initialize" : "mcp call " + calls;
        const result = table[key] ?? { content: [{ type: "text", text: "stub: no answer" }], isError: true };
        process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: req.id, result }) + "\\n");
      }
    });
    process.stdin.on("end", () => process.exit(0));
    return;
  }
  let answer = null;
  for (let n = argv.length; n > 0 && !answer; n--) answer = table[argv.slice(0, n).join(" ")] ?? null;
  answer = answer ?? { stdout: "", code: 2, stderr: "stub: no answer" };
  if (answer.delayMs) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, answer.delayMs);
  record({ end: Date.now() });
  if (answer.stderr) fs.writeSync(2, answer.stderr);
  fs.writeSync(1, answer.stdout);
  process.exit(answer.code);
}
`

export function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8')
}

export function stubCraftar(table: Record<string, Answer | unknown>): StubCraftar {
  const dir = tempDir('craftar-orca-stub-')
  const bin = join(dir, process.platform === 'win32' ? 'craftar.exe' : 'craftar')
  copyFileSync(process.execPath, bin)
  if (process.platform !== 'win32') chmodSync(bin, 0o755)
  const hook = join(dir, 'hook.cjs')
  writeFileSync(hook, HOOK)
  const tableFile = join(dir, 'table.json')
  writeFileSync(tableFile, JSON.stringify(table))
  const log = join(dir, 'calls.jsonl')
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_OPTIONS: `--require "${hook.replace(/\\/g, '/')}"`,
    CRAFTAR_STUB_LOG: log,
    CRAFTAR_STUB_TABLE: tableFile,
  }
  const calls = (): Call[] =>
    existsSync(log)
      ? readFileSync(log, 'utf8')
          .split('\n')
          .filter((l) => l !== '')
          .map((l) => JSON.parse(l) as Call)
          .filter((c) => c.request === undefined && c.end === undefined)
      : []
  const requests = (): Call[] =>
    existsSync(log)
      ? readFileSync(log, 'utf8')
          .split('\n')
          .filter((l) => l !== '')
          .map((l) => JSON.parse(l) as Call)
          .filter((c) => c.request !== undefined)
      : []
  // Each one-shot child's [start, end] (an mcp child has no end): for tests of what may not overlap.
  const spans = (): { argv: string[]; start: number; end: number }[] => {
    const lines = existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter((l) => l !== '').map((l) => JSON.parse(l) as Call) : []
    return lines
      .filter((c) => c.start !== undefined)
      .flatMap((c) => {
        const end = lines.find((e) => e.pid === c.pid && e.end !== undefined)?.end
        return end === undefined ? [] : [{ argv: c.argv, start: c.start as number, end }]
      })
  }
  return { bin, env, calls, requests, spans }
}
