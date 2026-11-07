// Which Orca workspaces are craftar's, and which one the person is looking at (spec 60 O9). A craftar
// workspace is a row on this host whose directory holds craftar.yaml as a regular file (lstat: a link
// is not followed). A row on another host is listed and never read. The focus is deduced from the
// context's name and branch; a tie is the person's to break, and their stored answer wins only while it
// still names one of the tied rows.
import { lstatSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import type { Active } from './orca-cli'

export type Row = { id: string; name: string; path: string; branch: string | null; hostId: string | null }

export interface Context {
  displayName: string
  branch: string
  /** The focused workspace's terminals (workspace.readContext); only their ids are read. */
  terminals?: { id: string }[]
}

export type Focus = { kind: 'one'; row: Row } | { kind: 'ask'; rows: Row[] } | { kind: 'none' }

function holdsCraftarYaml(dir: string): boolean {
  if (!isAbsolute(dir)) return false
  try {
    return lstatSync(join(dir, 'craftar.yaml')).isFile()
  } catch {
    return false
  }
}

/**
 * Whether a workspace.list row is on this machine. Orca 1.4.250 gives this machine's rows the host id
 * `local` (`orca-ide host list`: `local  this machine`), and null on hosts that record no host
 * (host-api: "The execution host; null for this machine on hosts that do not record one").
 */
export function onThisMachine(hostId: string | null): boolean {
  return hostId === null || hostId === 'local'
}

export function craftarWorkspaces(rows: Row[]): { local: Row[]; remote: Row[] } {
  const remote = rows.filter((r) => !onThisMachine(r.hostId))
  const local = rows.filter((r) => onThisMachine(r.hostId) && holdsCraftarYaml(r.path))
  return { local, remote }
}

export function focused(ctx: Context | null, rows: Row[], stored: string | null): Focus {
  if (!ctx) return { kind: 'none' }
  const match = rows.filter((r) => r.name === ctx.displayName && r.branch === ctx.branch)
  if (match.length === 1) return { kind: 'one', row: match[0] }
  if (match.length === 0) return { kind: 'none' }
  const chosen = match.find((r) => r.id === stored)
  return chosen ? { kind: 'one', row: chosen } : { kind: 'ask', rows: match }
}

/** What Orca's CLI said about the focus: the active workspace, and the workspaces holding the context's terminals. */
export interface FocusSource {
  active: Active
  /** null when Orca's CLI could not say; [] when the context has no terminal. */
  terminalPaths: string[] | null
}

/**
 * The focus, from Orca's CLI first (the user's ruling, 2026-11-07): the active workspace; else the one
 * workspace holding all the context's terminals; else name and branch with the person's answer. A tier
 * falls through only when it has no answer: an answer that is not a craftar workspace is no focus.
 */
export function focusedBy(src: FocusSource, ctx: Context | null, rows: Row[], stored: string | null): Focus {
  const byPath = (path: string): Focus => {
    const row = rows.find((r) => r.path === path)
    return row ? { kind: 'one', row } : { kind: 'none' }
  }
  if (src.active.kind === 'one') return byPath(src.active.path)
  if (src.terminalPaths && src.terminalPaths.length === 1) return byPath(src.terminalPaths[0])
  return focused(ctx, rows, stored)
}
