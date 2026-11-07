// Exact staging after a sync (spec 60 §7 step 4, O2): the result's written paths, its removed paths that
// git tracks, and craftar.lock — less what git ignores — through `git add -- <paths>`. Never -A, never a
// commit: the person commits. git is started as a child by its absolute path, with an argument array and
// `-C <workspace>`, every path after `--`.
import { findOnPath } from './resolve'
import { run } from './run'

const LOCK = 'craftar.lock'
// git's repository-location variables, which would point git at another repository than the workspace's.
const LOCATION = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_COMMON_DIR', 'GIT_NAMESPACE', 'GIT_PREFIX']

export interface Git {
  bin: string
  env: NodeJS.ProcessEnv
}

export function findGit(path: string, base: NodeJS.ProcessEnv = process.env): Git | null {
  const bin = findOnPath('git', path)
  if (!bin) return null
  const env = { ...base }
  for (const k of LOCATION) delete env[k]
  return { bin, env }
}

function nul(out: string): string[] {
  return out.split('\0').filter((p) => p !== '')
}

async function git(g: Git, ws: string, args: string[], input?: string): Promise<{ code: number | null; out: string }> {
  const r = await run(g.bin, ['-C', ws, ...args], g.env, 30_000, input)
  return { code: r.code, out: r.stdout }
}

export interface Staged {
  /** The paths now staged among the ones this sync touched. */
  staged: string[]
  /** Paths the sync touched that were not staged: ignored by git, or removed and never tracked. */
  leftOut: string[]
}

export class StageFailed extends Error {}

export async function stagePaths(g: Git, ws: string, result: { written: string[]; removed: { path: string }[] }): Promise<Staged> {
  const removed = result.removed.map((r) => r.path)
  const tracked = removed.length === 0 ? [] : nul((await git(g, ws, ['ls-files', '-z', '--', ...removed])).out)
  const wanted = [...new Set([...result.written, LOCK])]
  // Paths on stdin, NUL-separated (`-z` needs --stdin): a path never reaches the argument list here.
  const ci = await git(g, ws, ['check-ignore', '-z', '--stdin'], wanted.join('\0') + '\0')
  if (ci.code !== 0 && ci.code !== 1) throw new StageFailed('git check-ignore did not answer')
  const ignored = new Set(nul(ci.out))
  const toAdd = [...new Set([...wanted.filter((p) => !ignored.has(p)), ...tracked])].sort()
  const leftOut = [...result.written.filter((p) => ignored.has(p)), ...removed.filter((p) => !tracked.includes(p))].sort()
  if (toAdd.length === 0) return { staged: [], leftOut }
  const add = await git(g, ws, ['add', '--', ...toAdd])
  if (add.code !== 0) throw new StageFailed('git add did not succeed')
  const now = nul((await git(g, ws, ['diff', '--cached', '--name-only', '-z', '--', ...toAdd])).out).sort()
  return { staged: now, leftOut }
}
