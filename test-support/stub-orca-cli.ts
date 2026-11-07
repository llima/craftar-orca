// A stub `orca-ide` (Orca's CLI) for tests: a POSIX shell script that records its arguments and answers
// `worktree ps --json` and `terminal list --json` from canned documents. No test reaches the person's own
// Orca. POSIX only: the tests that use it are skipped on win32, and every other worker test puts an empty
// directory on PATH, so no `orca-ide` is found there and the focus falls back as it did before. It calls
// /bin/cat by its absolute path: a test puts the stub's directory alone on PATH.
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tempDir } from './tmp'

export interface OrcaCliStub {
  dir: string
  calls: () => string[]
}

export function stubOrcaCli(opts: { ps?: unknown; psCode?: number; psDelaySeconds?: number; terminals?: unknown } = {}): OrcaCliStub {
  const dir = tempDir('craftar-orca-cli-')
  writeFileSync(join(dir, 'ps.json'), JSON.stringify(opts.ps ?? { id: 'x', ok: true, result: { worktrees: [] } }))
  writeFileSync(join(dir, 'tl.json'), JSON.stringify(opts.terminals ?? { id: 'x', ok: true, result: { terminals: [] } }))
  const q = (p: string) => `'${p.replace(/'/g, `'\\''`)}'`
  const script = [
    '#!/bin/sh',
    `printf '%s\\n' "$*" >> ${q(join(dir, 'calls.log'))}`,
    'case "$*" in',
    `  "worktree ps --json") ${opts.psDelaySeconds ? `/bin/sleep ${opts.psDelaySeconds}; ` : ''}/bin/cat ${q(join(dir, 'ps.json'))}; exit ${opts.psCode ?? 0} ;;`,
    `  "terminal list --json") /bin/cat ${q(join(dir, 'tl.json'))} ;;`,
    '  *) exit 2 ;;',
    'esac',
    '',
  ].join('\n')
  const bin = join(dir, 'orca-ide')
  writeFileSync(bin, script)
  chmodSync(bin, 0o755)
  const log = join(dir, 'calls.log')
  return { dir, calls: () => (existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter((l) => l !== '') : []) }
}

/** A `worktree ps --json` answer: one row per path, the active one marked. */
export function psDoc(rows: { path: string; active?: boolean }[]): unknown {
  return { id: 'x', ok: true, result: { worktrees: rows.map((r) => ({ path: r.path, isActive: r.active === true, displayName: 'main', linkedPR: null })), totalCount: rows.length, truncated: false } }
}

/** A `terminal list --json` answer. */
export function terminalsDoc(rows: { handle: string; path: string }[]): unknown {
  return { id: 'x', ok: true, result: { terminals: rows.map((r) => ({ handle: r.handle, worktreePath: r.path, title: 'bash', preview: 'acme-user@acme-host:~$' })), totalCount: rows.length, truncated: false } }
}
