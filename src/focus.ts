// Which Orca workspaces are craftar's, and which one the person is looking at (spec 60 O9). A craftar
// workspace is a row on this host whose directory holds craftar.yaml as a regular file (lstat: a link
// is not followed). A row on another host is listed and never read. The focus is deduced from the
// context's name and branch; a tie is the person's to break, and their stored answer wins only while it
// still names one of the tied rows.
import { lstatSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'

export type Row = { id: string; name: string; path: string; branch: string | null; hostId: string | null }

export interface Context {
  displayName: string
  branch: string
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
