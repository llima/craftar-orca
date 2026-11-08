// Discard a hand edit (spec 60 §8a; the user's rulings of 2026-11-08): `craftar drift discard <path>` puts back what craftar would
// write for one `drift` or `orphan-drift` file. It is a whole sync, so it runs only when nothing else is pending; the last read
// before it fetches the Forge, and the discard runs `--offline` against that copy, so it writes exactly what the confirmation showed.
// Pure: no I/O. The child is started by the worker with an argument array.
import type { DriftDoc, StatusDoc } from './craftar'

/** The file craftar 1.8.0 lets a discard through, where a person may have typed a value: never offered. */
export const EXAMPLE_SETTINGS = '.claude/settings.craftar.example.json'
const PENDING: readonly string[] = ['new', 'update', 'adopt', 'orphan']

export type DriftRow = DriftDoc['files'][number]

/** Why Discard is not offered on this row, or null when it is (before the pending and diff checks). */
export function rowFault(row: DriftRow | undefined): string | null {
  if (!row) return 'not a file craftar lists as edited here'
  if (row.path === EXAMPLE_SETTINGS) return 'this file may hold a value you typed: discard it by hand if you mean to'
  if (row.state !== 'drift' && row.state !== 'orphan-drift') return 'only a file edited by hand can be discarded'
  return null
}

/** The files a discard would also write: anything pending makes the action "Update first". */
export function pendingOf(st: StatusDoc): string[] {
  return st.statuses.filter((s) => PENDING.includes(s.state)).map((s) => s.path)
}

/**
 * A fetch that failed on the second read: `status` reads a remote Forge in its reading mode, so it exits 0 with the cached copy and
 * says so with `fetched: false` and a `not fetched` warning. A Forge on this machine is never fetched; a ref that is a full commit
 * SHA cannot move, so it is no failure.
 */
export function fetchFailed(st: StatusDoc): string[] | null {
  const f = st.forge ?? {}
  if (!f.kind || f.kind === 'path' || f.fetched === true) return null
  if (typeof f.ref === 'string' && /^[0-9a-f]{40}$/.test(f.ref)) return null
  const words = st.warnings.filter((w) => /not fetched/.test(w))
  return words.length > 0 ? words : ['the Forge could not be fetched']
}

/** The argument array of the discard: one path, `--offline` against the copy just fetched, never `--overwrite-drift`. */
export function discardArgs(path: string, ws: string): string[] {
  return ['drift', 'discard', path, '--workspace', ws, '--offline']
}

/** After the run: how the file reads now, and every other row whose state moved since the confirmation's read. */
export function afterDiscard(before: StatusDoc, after: StatusDoc, path: string): { file: string; others: string[] } {
  const now = after.statuses.find((s) => s.path === path)
  const was = new Map(before.statuses.map((s) => [s.path, s.state]))
  const others = after.statuses
    .filter((s) => s.path !== path && was.get(s.path) !== s.state)
    .map((s) => `${s.path}: ${was.get(s.path) ?? 'not listed'} → ${s.state}`)
  for (const [p, st] of was) if (p !== path && !after.statuses.some((s) => s.path === p)) others.push(`${p}: ${st} → not listed`)
  return { file: now ? now.state : 'gone', others }
}
