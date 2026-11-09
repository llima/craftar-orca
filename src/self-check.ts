// The self-check shown at the top of the panel when anything fails (spec 60 §5): the binary found and
// absolute (a shim directory warned about, O1), its version at least the floor, doctor's error lines for
// the focused workspace (listed, never a fix applied), and whether the registry is on (writes need it,
// O2). Lines go to the panel only, never to the log: a doctor line can carry a path.
import { type Craftar, doctor, type DoctorDoc, ReadFailure, workspaces } from './craftar'
import { findCraftar } from './resolve'
import { childEnv, run, type RunResult } from './run'

// The newest "since" among the surfaces S1 reads (craftar-cli README, Upgrading): status --json with
// --offline 0.11.0, workspaces --json 0.12.0, doctor --json 0.15.0, unsetParams 0.20.0, drift show --json
// 0.22.0, the mcp diff tool and PIN_CHANGED 0.29.0, repos --json 0.33.0. A later slice that uses a newer
// surface raises it (the writing tools of craftar mcp: 0.35.0).
export const FLOOR = '0.33.0'

export interface Line {
  level: 'ok' | 'warn' | 'error'
  message: string
  /** Set on the lines that mean the person has to install or upgrade craftar (P1): the panel says these first. */
  install?: 'missing' | 'broken' | 'old'
}

export interface SelfCheckOptions {
  craftarPath: string
  craftarHome: string
  path: string
  baseEnv: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  /** A seam for tests: `craftar --version`. The stub craftar is a copy of node, which answers --version itself. */
  version?: (bin: string, env: NodeJS.ProcessEnv) => Promise<RunResult>
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
  const lines: Line[] = []
  // The binary is looked for first, with or without a workspace: a machine with Orca and no craftar learns it here.
  const found = findCraftar({ craftarPath: o.craftarPath, path: o.path, platform: o.platform })
  if (found.found === null) return { lines: [{ level: 'error', message: `craftar: ${found.reason}`, install: 'missing' }], craftar: null }
  lines.push({ level: 'ok', message: `craftar: ${found.found}` })
  if (found.shim) {
    lines.push({ level: 'warn', message: `craftar resolves under the ${found.shim} shim directory: a project's files can choose what runs` })
  }
  if (ws === null) return withoutWorkspace(o, found.found, lines)

  const craftar: Craftar = { bin: found.found, env: childEnv(o.baseEnv, o.craftarHome) }
  // The version comes from doctor --json's `version` (a contract since 0.15.0), read once with the
  // workspace's checks.
  let d: DoctorDoc
  try {
    d = await doctor(craftar, ws)
  } catch (e) {
    const code = e instanceof ReadFailure ? `exit ${e.code ?? 'none'}` : 'did not run'
    lines.push({ level: 'error', message: `craftar doctor --json gave no document (${code}): craftar older than 0.15.0, or broken`, install: 'broken' })
    return { lines, craftar: null }
  }
  const version = typeof d.version === 'string' ? d.version : ''
  if (!versionAtLeast(version, FLOOR)) {
    const shown = SEMVER.test(version) ? version : 'its version'
    lines.push(tooOld(shown))
    return { lines, craftar: null }
  }
  lines.push({ level: 'ok', message: `version ${version}` })
  const checked = version
  for (const c of opts.listErrors ? d.checks.filter((x) => x.level === 'error') : []) {
    lines.push({ level: 'error', message: `doctor ${c.id}: ${c.message}${c.fix ? ` (fix: ${c.fix})` : ''}` })
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

function tooOld(shown: string): Line {
  return { level: 'error', message: `craftar ${shown} is older than ${FLOOR}, the oldest with every surface this plugin reads: upgrade craftar`, install: 'old' }
}

/**
 * No craftar workspace in Orca: nothing to read, but whether craftar runs is still said (P1). `craftar --version`, the
 * probe's own call, reads no workspace and no network. The craftar is not handed back: there is nothing to read with it.
 */
async function withoutWorkspace(o: SelfCheckOptions, bin: string, lines: Line[]): Promise<{ lines: Line[]; craftar: null; version?: string | null }> {
  const env = childEnv(o.baseEnv, o.craftarHome)
  const r = await (o.version ?? ((b, e) => run(b, ['--version'], e)))(bin, env)
  const first = r.stdout.trim().split(/\r?\n/)[0] ?? ''
  if (r.code !== 0) {
    lines.push({ level: 'error', message: `craftar --version did not run (exit ${r.code ?? 'none'}): craftar is installed but does not start`, install: 'broken' })
    return { lines, craftar: null }
  }
  const version = SEMVER.test(first.trim()) ? first.trim() : ''
  if (!versionAtLeast(version, FLOOR)) {
    lines.push(tooOld(version !== '' ? version : 'its version'))
    return { lines, craftar: null }
  }
  lines.push({ level: 'ok', message: `version ${version}` })
  lines.push({ level: 'ok', message: 'no craftar workspace in Orca on this machine: nothing to read' })
  return { lines, craftar: null, version }
}
