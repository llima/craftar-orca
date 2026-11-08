// Send to Forge (spec 60 §8 step 3, O5, O7): `craftar drift promote <path> --workspace <abs dir> [--forge <dir>]
// [--dry-run] --json`, started as a child with an argument array. The dry run proves and shows the plan and
// writes nothing; the write, on a second click, writes the Forge's working tree — gated on git by craftar,
// never committed. `--forge` names a local clone, needed for a URL Forge only. A refusal is craftar's own
// words (its stderr); the result is shown and kept in memory only — `params` carries values.
import { isAbsolute } from 'node:path'
import type { Craftar } from './craftar'
import { CMD_REFUSED, run } from './run'

// A promote proves the change against every registered workspace: longer than a read.
const PROMOTE_TIMEOUT_MS = 180_000

export interface PromoteResult {
  workspace: string
  forge: string
  profile: string
  dryRun: boolean
  path: string
  ingredient: string
  outcome: string
  promoted: string
  written: { path: string; action: string }[]
  params: { key: string; old: unknown; value: unknown }[]
  sections: { key: string; name: string }[]
  /** What the variant holds as plain text: the base's params and sections it no longer cites. */
  flattened: { params: string[]; sections: string[] }
  dependents: unknown[]
  nextSync: { counts: Record<string, number> }
  impact: { registry: string; workspaces: unknown[] }
  warnings: string[]
}

export class PromoteRefused extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PromoteRefused'
  }
}

export async function promote(craftar: Craftar, ws: string, path: string, opts: { dryRun: boolean; forge: string | null; timeoutMs?: number }): Promise<PromoteResult> {
  if (!isAbsolute(ws)) throw new Error('craftar is given an absolute workspace directory only')
  if (path.startsWith('-') || isAbsolute(path) || path.trim() === '') throw new Error('not a workspace path')
  const args = ['drift', 'promote', path, '--workspace', ws, ...(opts.forge ? ['--forge', opts.forge] : []), ...(opts.dryRun ? ['--dry-run'] : []), '--json']
  const r = await run(craftar.bin, args, craftar.env, opts.timeoutMs ?? PROMOTE_TIMEOUT_MS)
  if (r.code === 0) {
    try {
      return JSON.parse(r.stdout) as PromoteResult
    } catch {
      throw new PromoteRefused('craftar drift promote gave no readable document')
    }
  }
  // A write stopped before it finished may have written some Forge files and not others.
  // cmd refused the values (S4): nothing was started, nothing written.
  if (r.code === null && r.stderr === CMD_REFUSED) throw new PromoteRefused(CMD_REFUSED)
  if (r.code === null && !opts.dryRun) throw new PromoteRefused("craftar drift promote did not finish in time. The Forge's working tree may be partly written: look at git status in the Forge before sending again")
  const words = r.stderr.trim()
  throw new PromoteRefused(words !== '' ? words : `craftar drift promote failed (exit ${r.code ?? 'none'})`)
}
