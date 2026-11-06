// A stub `craftar` for tests (spec 60 §15): a copy of node named `craftar`, with a preload that records
// each call (its argv and CRAFTAR_HOME) and answers from a table keyed by the leading arguments. No test
// starts the person's own craftar. Node resolves its first argument to an absolute script path before a
// preload runs, so the preload reads it back with basename (craftar-cli's fake-git does the same).
import { chmodSync, copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tempDir } from './tmp'

export interface Answer {
  stdout: string
  code: number
  stderr?: string
}

export interface Call {
  argv: string[]
  home: string | null
}

export interface StubCraftar {
  bin: string
  env: NodeJS.ProcessEnv
  calls: () => Call[]
}

const HOOK = `"use strict";
const fs = require("fs");
const path = require("path");
if (path.basename(process.execPath).toLowerCase().replace(/\\.exe$/, "") === "craftar") {
  const argv = process.argv.slice(1);
  if (argv[0]) argv[0] = path.basename(argv[0]);
  fs.appendFileSync(process.env.CRAFTAR_STUB_LOG, JSON.stringify({ argv, home: process.env.CRAFTAR_HOME ?? null }) + "\\n");
  const table = JSON.parse(fs.readFileSync(process.env.CRAFTAR_STUB_TABLE, "utf8"));
  let answer = null;
  for (let n = argv.length; n > 0 && !answer; n--) answer = table[argv.slice(0, n).join(" ")] ?? null;
  answer = answer ?? { stdout: "", code: 2, stderr: "stub: no answer" };
  if (answer.stderr) process.stderr.write(answer.stderr);
  process.stdout.write(answer.stdout, () => process.exit(answer.code));
}
`

export function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8')
}

export function stubCraftar(table: Record<string, Answer>): StubCraftar {
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
      : []
  return { bin, env, calls }
}
