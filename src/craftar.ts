// The read surface (spec 60 §3, §7.1): one function per craftar read, each an argument array through
// run() — never a shell — with an absolute --workspace. Only the periodic status read may reach the
// network; every other read passes --offline or runs without --fetch. A JSON document is read whatever
// the exit code (status --json and drift show --json exit 1 with one for a refused sync); only a missing
// or unreadable document is a failure, and that failure carries the exit code alone — nothing of craftar's
// stdout or stderr, which can hold a workspace path. Whether the worker can start craftar inside Orca at
// all is pending the S0 probe (README, "Pending the S0 probe").
import { isAbsolute } from 'node:path'
import { run } from './run'

export interface Craftar {
  bin: string
  env: NodeJS.ProcessEnv
}

export class ReadFailure extends Error {
  constructor(
    readonly read: string,
    readonly code: number | null,
  ) {
    super(`craftar ${read}: no JSON document (exit ${code ?? 'none'})`)
    this.name = 'ReadFailure'
  }
}

export type FileState =
  | 'unchanged'
  | 'new'
  | 'update'
  | 'adopt'
  | 'drift'
  | 'collision'
  | 'orphan'
  | 'orphan-drift'
  | (string & {})

export interface ForgeInfo {
  kind?: string
  source?: string
  ref?: string | null
  defaultBranch?: string | null
  commit?: string | null
  lockCommit?: string | null
  fetched?: boolean
}

export interface UnsetParam {
  key: string
  declaredBy: string[]
  citedBy: string[]
}

export interface StatusDoc {
  forge: ForgeInfo
  statuses: { path: string; state: FileState; target: string; ingredient: string }[]
  warnings: string[]
  unsetParams: UnsetParam[]
}

export interface DriftDoc {
  workspace: string
  profile: string
  files: {
    path: string
    state: FileState
    target: string
    ingredient: string
    forge: string
    promotable: boolean
    reason: string | null
  }[]
  warnings: string[]
  unsetParams: UnsetParam[]
}

export interface ReposDoc {
  workspace: string
  profile: string
  repos: { name: string; url: string; path: string; ref: string | null; state: string; reason: string | null }[]
  warnings: string[]
}

export interface DoctorDoc {
  version: string
  workspace: string | null
  checks: { id: string; scope: string; level: 'ok' | 'warn' | 'error' | (string & {}); message: string; fix: string | null }[]
}

export interface WorkspacesDoc {
  registry: string | null
  workspaces: {
    name: string
    path: string
    profile: string | null
    forge: (ForgeInfo & { key?: string | null }) | null
    status: string
    forgeMoved: boolean
    files: Record<string, number>
  }[]
  warnings: string[]
}

async function readJson<T>(c: Craftar, read: string, args: string[]): Promise<T> {
  const r = await run(c.bin, args, c.env)
  let doc: unknown
  try {
    doc = JSON.parse(r.stdout)
  } catch {
    throw new ReadFailure(read, r.code)
  }
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) throw new ReadFailure(read, r.code)
  return doc as T
}

function workspaceArg(ws: string): string[] {
  if (!isAbsolute(ws)) throw new Error('craftar is given an absolute workspace directory only')
  return ['--workspace', ws]
}

export async function status(c: Craftar, ws: string, opts: { fetch: boolean }): Promise<StatusDoc> {
  const args = ['status', '--json', ...(opts.fetch ? [] : ['--offline']), ...workspaceArg(ws)]
  return readJson(c, 'status', args)
}

export async function driftShow(c: Craftar, ws: string): Promise<DriftDoc> {
  return readJson(c, 'drift show', ['drift', 'show', '--json', '--offline', ...workspaceArg(ws)])
}

export async function repos(c: Craftar, ws: string): Promise<ReposDoc> {
  return readJson(c, 'repos', ['repos', '--json', '--offline', ...workspaceArg(ws)])
}

// doctor reads offline unless --fetch, which the plugin never passes.
export async function doctor(c: Craftar, ws: string): Promise<DoctorDoc> {
  return readJson(c, 'doctor', ['doctor', '--json', ...workspaceArg(ws)])
}

// doctor with no workspace runs the machine checks only; the self-check reads craftar's version from it.
export async function doctorMachine(c: Craftar): Promise<DoctorDoc> {
  return readJson(c, 'doctor', ['doctor', '--json'])
}

// workspaces is about every workspace and takes no --workspace; without --fetch it reads no network.
export async function workspaces(c: Craftar): Promise<WorkspacesDoc> {
  return readJson(c, 'workspaces', ['workspaces', '--json'])
}
