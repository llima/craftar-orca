// The self-check shown at the top of the panel when anything fails (spec 60 §5): the binary found and
// absolute (a shim directory warned about, O1), its version at least the floor, doctor's error lines for
// the focused workspace (listed, never a fix applied), and whether the registry is on (writes need it,
// O2). Lines go to the panel only, never to the log: a doctor line can carry a path.
import { type Craftar, doctor, type DoctorDoc, ReadFailure, workspaces } from './craftar'
import { findCraftar } from './resolve'
import { childEnv } from './run'

// The newest "since" among the surfaces S1 reads (craftar-cli README, Upgrading): status --json with
// --offline 0.11.0, workspaces --json 0.12.0, doctor --json 0.15.0, unsetParams 0.20.0, drift show --json
// 0.22.0, the mcp diff tool and PIN_CHANGED 0.29.0, repos --json 0.33.0. A later slice that uses a newer
// surface raises it (the writing tools of craftar mcp: 0.35.0).
export const FLOOR = '0.33.0'

export interface Line {
  level: 'ok' | 'warn' | 'error'
  message: string
}

export interface SelfCheckOptions {
  craftarPath: string
  craftarHome: string
  path: string
  baseEnv: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
}

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/

export function versionAtLeast(version: string, floor: string): boolean {
  const v = SEMVER.exec(version.trim())
  const f = SEMVER.exec(floor)
  if (!v || !f) return false
  for (let i = 1; i <= 3; i++) {
    const a = Number(v[i])
    const b = Number(f[i])
    if (a !== b) return a > b
  }
  return true
}

function readError(what: string, e: unknown): Line {
  const code = e instanceof ReadFailure ? `exit ${e.code ?? 'none'}` : 'did not run'
  return { level: 'warn', message: `${what} could not be read (${code})` }
}

/**
 * `ws` is the craftar workspace doctor is asked about — the focused one, else any local one — never Orca's
 * own working directory, which doctor would read when it holds a craftar.yaml. With none there is nothing
 * to read and nothing is started. `listErrors` is false when `ws` is not the focused workspace.
 */
export async function selfCheck(
  o: SelfCheckOptions,
  ws: string | null,
  opts: { listErrors: boolean } = { listErrors: true },
): Promise<{ lines: Line[]; craftar: Craftar | null; version?: string | null }> {
  if (ws === null) return { lines: [{ level: 'ok', message: 'no craftar workspace in Orca on this machine — nothing to read' }], craftar: null }
  const lines: Line[] = []
  const found = findCraftar({ craftarPath: o.craftarPath, path: o.path, platform: o.platform })
  if (found.found === null) return { lines: [{ level: 'error', message: `craftar: ${found.reason}` }], craftar: null }
  lines.push({ level: 'ok', message: `craftar: ${found.found}` })
  if (found.shim) {
    lines.push({ level: 'warn', message: `craftar resolves under the ${found.shim} shim directory: a project's files can choose what runs` })
  }

  const craftar: Craftar = { bin: found.found, env: childEnv(o.baseEnv, o.craftarHome) }
  // The version comes from doctor --json's `version` (a contract since 0.15.0), read once with the
  // workspace's checks.
  let d: DoctorDoc
  try {
    d = await doctor(craftar, ws)
  } catch (e) {
    const code = e instanceof ReadFailure ? `exit ${e.code ?? 'none'}` : 'did not run'
    lines.push({ level: 'error', message: `craftar doctor --json gave no document (${code}): craftar older than 0.15.0, or broken` })
    return { lines, craftar: null }
  }
  const version = typeof d.version === 'string' ? d.version : ''
  if (!versionAtLeast(version, FLOOR)) {
    const shown = SEMVER.test(version) ? version : 'its version'
    lines.push({ level: 'error', message: `craftar ${shown} is older than ${FLOOR}, the oldest with every surface this plugin reads — upgrade craftar` })
    return { lines, craftar: null }
  }
  lines.push({ level: 'ok', message: `version ${version}` })
  const checked = version
  for (const c of opts.listErrors ? d.checks.filter((x) => x.level === 'error') : []) {
    lines.push({ level: 'error', message: `doctor ${c.id}: ${c.message}${c.fix ? ` — ${c.fix}` : ''}` })
  }

  if ((craftar.env.CRAFTAR_NO_REGISTRY ?? '') !== '') {
    lines.push({ level: 'warn', message: 'the registry is off (CRAFTAR_NO_REGISTRY): updates from the panel need it' })
  } else {
    try {
      const w = await workspaces(craftar)
      lines.push({ level: 'ok', message: `registry: ${w.workspaces.length} registered` })
    } catch (e) {
      lines.push(readError('the registry', e))
    }
  }
  return { lines, craftar, version: checked }
}
