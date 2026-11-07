// Orca's CLI as the source of the focus (spec 60 O9; the user's ruling of 2026-11-07). Orca 1.4.250's
// `workspace.readContext` names a workspace by display name and branch only, which tie (every `main`
// worktree is named `main`); `orca-ide worktree ps --json` marks the one in focus `isActive` (measured: it
// follows every switch within two seconds), and `orca-ide terminal list --json` maps a terminal to its
// workspace. The CLI is started as a child, by the absolute path found on PATH, with an argument array; of
// its answer only paths are kept, in memory — it lists linked PRs, agents and other workspaces, so nothing
// of it is logged or stored, and its stderr is not read.
import { findOnPath } from './resolve'
import { run } from './run'

// Short: the focus waits for it, in the focus queue.
const TIMEOUT_MS = 5_000

export interface OrcaCli {
  bin: string
  env: NodeJS.ProcessEnv
}

export type Active = { kind: 'one'; path: string } | { kind: 'none' } | { kind: 'failed'; reason: string }

export function findOrcaCli(path: string, env: NodeJS.ProcessEnv = process.env): OrcaCli | null {
  const bin = findOnPath('orca-ide', path)
  return bin ? { bin, env } : null
}

async function rows(cli: OrcaCli, args: string[], key: string): Promise<unknown[] | { failed: string }> {
  const r = await run(cli.bin, args, cli.env, TIMEOUT_MS)
  if (r.code !== 0) return { failed: r.code === null ? 'did not finish' : `exit ${r.code}` }
  try {
    const list = (JSON.parse(r.stdout) as { result?: Record<string, unknown> }).result?.[key]
    return Array.isArray(list) ? list : { failed: 'no readable answer' }
  } catch {
    return { failed: 'no readable answer' }
  }
}

/** The path of the workspace in focus: exactly one active row, else none. */
export async function activeWorkspacePath(cli: OrcaCli): Promise<Active> {
  const r = await rows(cli, ['worktree', 'ps', '--json'], 'worktrees')
  if (!Array.isArray(r)) return { kind: 'failed', reason: r.failed }
  const active = r
    .map((w) => w as { path?: unknown; isActive?: unknown })
    .filter((w) => w.isActive === true && typeof w.path === 'string')
    .map((w) => w.path as string)
  return active.length === 1 ? { kind: 'one', path: active[0] } : { kind: 'none' }
}

/** The workspaces (their paths, sorted, each once) that hold any of these terminals; null when Orca cannot say. */
export async function terminalWorkspacePaths(cli: OrcaCli, ids: readonly string[]): Promise<string[] | null> {
  if (ids.length === 0) return []
  const r = await rows(cli, ['terminal', 'list', '--json'], 'terminals')
  if (!Array.isArray(r)) return null
  const wanted = new Set(ids)
  const paths = new Set<string>()
  for (const t of r as { handle?: unknown; worktreePath?: unknown }[]) {
    if (typeof t.handle === 'string' && wanted.has(t.handle) && typeof t.worktreePath === 'string') paths.add(t.worktreePath)
  }
  return [...paths].sort()
}

/**
 * Brings a terminal forward in Orca's window: terminal.create opens it "in the background" (host API, Orca
 * 1.4.250), where the person cannot see a question it asks. The handle is the one terminal.create returned
 * (the same `term_…` the CLI lists). Whether it worked is the only thing kept.
 */
export async function switchToTerminal(cli: OrcaCli, terminalId: string): Promise<boolean> {
  const r = await run(cli.bin, ['terminal', 'switch', '--terminal', terminalId, '--json'], cli.env, TIMEOUT_MS)
  return r.code === 0
}

/** Whether Orca still lists this terminal; null when its CLI cannot say. */
export async function terminalListed(cli: OrcaCli, terminalId: string): Promise<boolean | null> {
  const r = await rows(cli, ['terminal', 'list', '--json'], 'terminals')
  if (!Array.isArray(r)) return null
  return (r as { handle?: unknown }[]).some((t) => t.handle === terminalId)
}
