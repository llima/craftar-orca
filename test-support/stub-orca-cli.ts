// A stub of Orca's CLI for tests, named as the platform names it (orcaCliName: `orca-ide` on Linux, `orca`
// on macOS; never win32): a POSIX shell script that records its arguments and answers
// `worktree ps --json` and `terminal list --json` from canned documents. No test reaches the person's own
// Orca. POSIX only: the tests that use it are skipped on win32, and every other worker test puts an empty
// directory on PATH, so no Orca CLI is found there and the focus falls back as it did before. It calls
// /bin/cat by its absolute path: a test puts the stub's directory alone on PATH.
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { orcaCliName } from '../src/orca-cli'
import { tempDir } from './tmp'

export interface OrcaCliStub {
  dir: string
  calls: () => string[]
  /** The exit code `terminal switch` answers with from now on. */
  setSwitchCode: (code: number) => void
}

export function stubOrcaCli(opts: { ps?: unknown; psCode?: number; psDelaySeconds?: number; terminals?: unknown; switchCode?: number } = {}): OrcaCliStub {
  const dir = tempDir('craftar-orca-cli-')
  writeFileSync(join(dir, 'ps.json'), JSON.stringify(opts.ps ?? { id: 'x', ok: true, result: { worktrees: [] } }))
  writeFileSync(join(dir, 'tl.json'), JSON.stringify(opts.terminals ?? { id: 'x', ok: true, result: { terminals: [] } }))
  writeFileSync(join(dir, 'sw.json'), JSON.stringify({ id: 'x', ok: true, result: {} }))
  writeFileSync(join(dir, 'sw.code'), String(opts.switchCode ?? 0))
  const q = (p: string) => `'${p.replace(/'/g, `'\\''`)}'`
  const script = [
    '#!/bin/sh',
    `printf '%s\\n' "$*" >> ${q(join(dir, 'calls.log'))}`,
    'case "$*" in',
    `  "worktree ps --json") ${opts.psDelaySeconds ? `/bin/sleep ${opts.psDelaySeconds}; ` : ''}/bin/cat ${q(join(dir, 'ps.json'))}; exit ${opts.psCode ?? 0} ;;`,
    `  "terminal list --json") /bin/cat ${q(join(dir, 'tl.json'))} ;;`,
    `  "terminal switch --terminal "*) /bin/cat ${q(join(dir, 'sw.json'))}; exit $(/bin/cat ${q(join(dir, 'sw.code'))}) ;;`,
    `  "reference add "*) /bin/cat ${q(join(dir, 'sw.json'))} ;;`,
    '  *) exit 2 ;;',
    'esac',
    '',
  ].join('\n')
  const bin = join(dir, orcaCliName())
  writeFileSync(bin, script)
  chmodSync(bin, 0o755)
  const log = join(dir, 'calls.log')
  return {
    dir,
    calls: () => (existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter((l) => l !== '') : []),
    setSwitchCode: (code) => writeFileSync(join(dir, 'sw.code'), String(code)),
  }
}

/** A `worktree ps --json` answer: one row per path, the active one marked. */
export function psDoc(rows: { path: string; active?: boolean }[]): unknown {
  return { id: 'x', ok: true, result: { worktrees: rows.map((r) => ({ path: r.path, isActive: r.active === true, displayName: 'main', linkedPR: null })), totalCount: rows.length, truncated: false } }
}

/** A `terminal list --json` answer. */
export function terminalsDoc(rows: { handle: string; path: string }[]): unknown {
  return { id: 'x', ok: true, result: { terminals: rows.map((r) => ({ handle: r.handle, worktreePath: r.path, title: 'bash', preview: 'acme-user@acme-host:~$' })), totalCount: rows.length, truncated: false } }
}
