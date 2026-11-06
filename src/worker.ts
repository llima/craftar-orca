// The craftar worker. S0: the status bar item that keeps the worker alive (spec 60 §2.4), a heartbeat
// that measures how long it stays alive, and the `craftar.probe` command that measures what spec 60
// §12 left unmeasured. It reads craftar's version only; nothing here writes a workspace or a Forge.
import type { OrcaWorkerApi } from 'orca/worker'
import { findCraftar, findOnPath } from './resolve'
import { childEnv, run } from './run'

const ITEM = 'craftar'
const HEARTBEAT = 'probe.heartbeat'
const HEARTBEAT_MS = 60_000
// A fixed, harmless command: no value of anyone's is put into a terminal (spec 60 §10).
const PROBE_COMMAND = 'echo craftar-probe'
const PROBE_MARK = 'craftar-probe'
const WATCHED_ENV = ['CRAFTAR_HOME', 'SSH_AUTH_SOCK', 'GIT_AUTHOR_NAME', 'GH_TOKEN'] as const

interface Heartbeat {
  startedAt: number
  ticks: number
  last: number
}

let timer: ReturnType<typeof setInterval> | null = null
let firstBeat: Promise<void> = Promise.resolve()

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

async function beat(orca: OrcaWorkerApi, startedAt: number): Promise<void> {
  const prev = (await orca.storage.get(HEARTBEAT)) as Heartbeat | null
  const same = prev && prev.startedAt === startedAt
  const next: Heartbeat = { startedAt, ticks: same ? prev.ticks + 1 : 0, last: Date.now() }
  await orca.storage.set(HEARTBEAT, { startedAt: next.startedAt, ticks: next.ticks, last: next.last })
}

async function focusedWorkspaceId(orca: OrcaWorkerApi): Promise<string | null> {
  const ctx = (await orca.host.call('workspace.readContext', {})) as { branch: string; displayName: string } | null
  const { workspaces } = (await orca.host.call('workspace.list', {})) as {
    workspaces: { id: string; name: string; branch: string | null; hostId: string | null }[]
  }
  const local = workspaces.filter((w) => w.hostId === null)
  if (ctx) {
    const match = local.filter((w) => w.name === ctx.displayName && w.branch === ctx.branch)
    if (match.length === 1) return match[0].id
  }
  // Probe only: with no exact match, the one local workspace. S1 deduces the focus as O9 rules.
  return local.length === 1 ? local[0].id : null
}

function failed(what: string, e: unknown): string {
  const code = e && typeof e === 'object' && 'code' in e ? String((e as { code: unknown }).code) : 'error'
  return `${what}: failed (${code})`
}

async function terminalProbe(orca: OrcaWorkerApi): Promise<string[]> {
  const workspaceId = await focusedWorkspaceId(orca)
  if (!workspaceId) return ['terminal: not opened — no single local workspace to open it in (focus one and run the probe again)']
  const { terminalId } = (await orca.host.call('terminal.create', {
    workspaceId,
    title: 'craftar probe',
    command: PROBE_COMMAND,
  })) as { terminalId: string }
  let lines: string[] = []
  for (let i = 0; i < 20; i++) {
    lines = ((await orca.host.call('terminal.read', { terminalId, maxLines: 40 })) as { lines: string[] }).lines
    if (lines.some((l) => l.trim() === PROBE_MARK)) break
    await new Promise((r) => setTimeout(r, 250))
  }
  const seen = lines.some((l) => l.trim() === PROBE_MARK)
  return [
    `terminal: ${seen ? `${PROBE_MARK} seen` : `${PROBE_MARK} not seen after 5 s`} (the lines below show its prompt: which shell, which directory)`,
    ...lines.slice(-8).map((l) => `  | ${l}`),
  ]
}

export async function probe(orca: OrcaWorkerApi, startedAt: number): Promise<string> {
  const { settings } = (await orca.host.call('settings.get', {})) as { settings: Record<string, unknown> }
  const craftarPath = text(settings.craftarPath)
  const craftarHome = text(settings.craftarHome)
  const out: string[] = ['craftar probe — S0 (spec 60 §12)']

  const found = findCraftar({ craftarPath, path: process.env.PATH ?? '' })
  if (found.found === null) {
    out.push(`craftar: not found — ${found.reason}`)
  } else {
    out.push(`craftar: found at ${found.found}${found.shim ? ` (under a ${found.shim} shim directory: a project's files can choose what runs)` : ''}`)
    const r = await run(found.found, ['--version'], childEnv(process.env, craftarHome))
    out.push(r.code === 0 ? `version: ${r.stdout.trim().split(/\r?\n/)[0]}` : `version: craftar --version failed (exit ${r.code ?? 'none'})`)
  }
  out.push(`CRAFTAR_HOME: ${craftarHome.trim() !== '' ? 'set from the setting' : 'not set (craftar uses its default)'}`)
  out.push(`worker environment: ${WATCHED_ENV.map((k) => `${k} ${process.env[k] ? 'present' : 'absent'}`).join(', ')}`)
  const orcaCli = findOnPath('orca', process.env.PATH ?? '')
  out.push(`orca CLI: ${orcaCli ? 'on an absolute PATH entry' : 'not on an absolute PATH entry'}`)

  await firstBeat
  const hb = (await orca.storage.get(HEARTBEAT).catch(() => null)) as Heartbeat | null
  const upMin = Math.round((Date.now() - startedAt) / 60_000)
  out.push(`worker alive: ${upMin} min since this start${hb && hb.startedAt === startedAt ? `, ${hb.ticks} heartbeats` : ''}`)

  let terminal: string[]
  try {
    terminal = await terminalProbe(orca)
  } catch (e) {
    terminal = [failed('terminal', e)]
  }
  out.push('notifications.show: no action (host-api 1.3) — the panel holds the one click')
  // The terminal's lines are shown to the person who ran the probe and never logged: a prompt can carry a
  // host name, a user name or a directory (spec 60 O11).
  orca.log(out.join('\n'))
  return [...out, ...terminal].join('\n')
}

export default function activate(orca: OrcaWorkerApi): void {
  const startedAt = Date.now()
  const tick = (): Promise<void> => beat(orca, startedAt).catch((e) => orca.log(failed('heartbeat', e)))
  orca.host
    .call('statusBar.update', { id: ITEM, text: 'craftar', tooltip: 'craftar — not reading yet', icon: 'layers' })
    .catch((e) => orca.log(failed('status bar', e)))
  firstBeat = tick()
  timer = setInterval(() => void tick(), HEARTBEAT_MS)
  if (typeof timer === 'object' && timer && 'unref' in timer) timer.unref()
  orca.commands.register('craftar.probe', () => probe(orca, startedAt))
}

export function deactivate(): void {
  if (timer) clearInterval(timer)
  timer = null
}
