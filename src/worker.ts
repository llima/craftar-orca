// The craftar worker. S1, the read path: the self-check on enable (spec 60 §5), the reads of the focused
// craftar workspace on every focus change (offline) and of every local one on the periodic check (the
// only read that may fetch), the panel's requests, and the status bar item that keeps the worker alive
// (§2.4; pending the S0 probe — README). S0's probe command and heartbeat stay until the probe is
// reported. Nothing here writes a workspace or a Forge, opens a terminal or shows a notification.
import type { OrcaWorkerApi } from 'orca/worker'
import { type Craftar, driftShow, ReadFailure, repos, workspaces as registryRead, type DriftDoc, type ReposDoc, type WorkspacesDoc } from './craftar'
import { DiffChild, DiffRefused } from './diff-child'
import { craftarWorkspaces, focused, type Context, type Focus, type Row } from './focus'
import { barFor, buildModel, type PanelModel } from './model'
import { findCraftar, findOnPath } from './resolve'
import { childEnv, run } from './run'
import { intervalMs, readStatus, type Reason, Serial } from './scheduler'
import { type Line, selfCheck } from './self-check'

const ITEM = 'craftar'
const HEARTBEAT = 'probe.heartbeat'
const FOCUS_CHOICE = 'focus.choice'
const FETCHED_AT = 'fetchedAt'
// The queue key of the focus refresh; a workspace's key is its absolute path, which this cannot be.
const FOCUS_QUEUE = ' focus'
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
    out.push(`craftar: found at ${found.found}${found.shim ? ` (under the ${found.shim} shim directory: a project's files can choose what runs)` : ''}`)
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
  // Nothing of the report is logged: craftar's path and output, and the terminal's lines — a prompt can
  // carry a host name, a user name or a directory (spec 60 O11) — are shown to the person who ran it.
  orca.log('probe ran (its report is shown to the person who ran it, not logged)')
  return [...out, ...terminal].join('\n')
}

interface State {
  orca: OrcaWorkerApi
  craftar: Craftar | null
  selfCheck: Line[]
  focus: Focus
  remote: Row[]
  models: Map<string, PanelModel>
  failed: Set<string>
  queue: Serial
  diff: { ws: string; child: DiffChild } | null
  work: Set<Promise<unknown>>
  /** The craftarPath and craftarHome the current craftar and diff child were built from (O1). */
  usedKey: string | null
  periodicTimer: ReturnType<typeof setTimeout> | null
}

let st: State | null = null

interface Settings {
  craftarPath: string
  craftarHome: string
  intervalMinutes: unknown
  fetch: boolean
}

async function readSettings(orca: OrcaWorkerApi): Promise<Settings> {
  const { settings } = (await orca.host.call('settings.get', {})) as { settings: Record<string, unknown> }
  return {
    craftarPath: text(settings.craftarPath),
    craftarHome: text(settings.craftarHome),
    intervalMinutes: settings.intervalMinutes,
    fetch: settings.fetch !== false,
  }
}

function track<T>(s: State, p: Promise<T>): Promise<T> {
  s.work.add(p)
  void p.finally(() => s.work.delete(p)).catch(() => undefined)
  return p
}

/** Resolves once every read the worker started has finished (tests, and the panel's refresh). */
export async function settled(): Promise<void> {
  const s = st
  if (!s) return
  while (s.work.size > 0) await Promise.allSettled([...s.work])
}

async function listRows(orca: OrcaWorkerApi): Promise<{ local: Row[]; remote: Row[] }> {
  const { workspaces } = (await orca.host.call('workspace.list', {})) as { workspaces: Row[] }
  return craftarWorkspaces(workspaces.map((w) => ({ id: w.id, name: w.name, path: w.path, branch: w.branch ?? null, hostId: w.hostId ?? null })))
}

function focusedPath(s: State): string | null {
  return s.focus.kind === 'one' ? s.focus.row.path : null
}

async function fetchedAtMap(orca: OrcaWorkerApi): Promise<Record<string, number>> {
  const v = (await orca.storage.get(FETCHED_AT).catch(() => null)) as Record<string, number> | null
  return v && typeof v === 'object' ? v : {}
}

function failure(read: string, e: unknown): string {
  return e instanceof ReadFailure ? e.message : `craftar ${read}: did not run`
}

async function optional<T>(read: string, p: Promise<T>, errors: string[]): Promise<T | null> {
  try {
    return await p
  } catch (e) {
    errors.push(failure(read, e))
    return null
  }
}

async function readWorkspace(s: State, row: Row, reason: Reason, settings: Settings): Promise<void> {
  const craftar = s.craftar
  if (!craftar) return
  await s.queue.run(row.path, async () => {
    let status
    try {
      status = await readStatus(craftar, row.path, reason, settings)
    } catch (e) {
      s.failed.add(row.path)
      s.orca.log(`read failed for a workspace: ${e instanceof ReadFailure ? `exit ${e.code ?? 'none'}` : 'did not run'}`)
      return
    }
    s.failed.delete(row.path)
    const errors: string[] = []
    const fetched = await fetchedAtMap(s.orca)
    if (status.forge?.fetched === true) {
      fetched[row.path] = Date.now()
      await s.orca.storage.set(FETCHED_AT, fetched)
    }
    const drift: DriftDoc | null = await optional('drift show', driftShow(craftar, row.path), errors)
    const rp: ReposDoc | null = await optional('repos', repos(craftar, row.path), errors)
    const registry: WorkspacesDoc | null = await optional('workspaces', registryRead(craftar), errors)
    s.models.set(
      row.path,
      buildModel({ ws: row.path, name: row.name, status, drift, repos: rp, registry, fetchedAt: fetched[row.path] ?? null, readAt: Date.now(), errors }),
    )
  })
}

export interface View {
  focus: Focus['kind']
  selfCheck: Line[]
  model: PanelModel | null
  readFailed: boolean
  ask: { id: string; name: string; path: string }[]
  remote: { name: string; path: string }[]
}

function view(s: State): View {
  const ws = focusedPath(s)
  return {
    focus: s.focus.kind,
    selfCheck: s.selfCheck,
    model: ws ? (s.models.get(ws) ?? null) : null,
    readFailed: ws ? s.failed.has(ws) : false,
    ask: s.focus.kind === 'ask' ? s.focus.rows.map((r) => ({ id: r.id, name: r.name, path: r.path })) : [],
    remote: s.remote.map((r) => ({ name: r.name, path: r.path })),
  }
}

async function publish(s: State): Promise<void> {
  const ws = focusedPath(s)
  const broken = s.craftar === null && s.selfCheck.some((l) => l.level === 'error')
  const m = ws ? (s.models.get(ws) ?? null) : null
  const bar = barFor(broken || (ws !== null && s.failed.has(ws)) ? 'error' : m)
  const tooltip = ws ? `craftar — ${ws}` : 'craftar — no craftar workspace focused'
  await s.orca.host.call('statusBar.update', { id: ITEM, text: bar.text, tone: bar.tone, tooltip, icon: 'layers' }).catch((e) => s.orca.log(failed('status bar', e)))
  s.orca.panels.post('state.changed', view(s) as never)
}

async function refreshFocus(s: State, ctx?: Context | null, recheck = false): Promise<void> {
  const settings = await readSettings(s.orca)
  const { local, remote } = await listRows(s.orca)
  s.remote = remote
  const context = ctx !== undefined ? ctx : ((await s.orca.host.call('workspace.readContext', {})) as Context | null)
  const stored = (await s.orca.storage.get(FOCUS_CHOICE).catch(() => null)) as string | null
  const before = focusedPath(s)
  s.focus = focused(context, local, typeof stored === 'string' ? stored : null)
  const ws = focusedPath(s)
  if (s.diff && s.diff.ws !== ws) await stopDiff(s)
  await ensureCheck(s, settings, local, recheck || before !== ws)
  if (s.focus.kind === 'one') await readWorkspace(s, s.focus.row, 'focus', settings)
  await publish(s)
}

function settingsKey(st: Settings): string {
  return `${st.craftarPath}\0${st.craftarHome}`
}

async function stopDiff(s: State): Promise<void> {
  const old = s.diff
  s.diff = null
  if (old) await old.child.stop()
}

/**
 * Runs the self-check when asked, when none ran yet, or when craftarPath or craftarHome changed — then the
 * diff child built from the old settings is stopped too (O1). doctor is asked about the focused workspace,
 * else any local one, and runs in that workspace's queue so it never overlaps a read of it.
 */
async function ensureCheck(s: State, settings: Settings, local: Row[], force: boolean): Promise<void> {
  const key = settingsKey(settings)
  const changed = s.usedKey !== null && s.usedKey !== key
  if (!force && !changed && s.selfCheck.length > 0) return
  if (changed) await stopDiff(s)
  const focusedWs = focusedPath(s)
  const ws = focusedWs ?? local[0]?.path ?? null
  const check = () =>
    selfCheck({ craftarPath: settings.craftarPath, craftarHome: settings.craftarHome, path: process.env.PATH ?? '', baseEnv: process.env }, ws, {
      listErrors: ws !== null && ws === focusedWs,
    })
  const r = ws === null ? await check() : await s.queue.run(ws, check)
  s.selfCheck = r.lines
  s.craftar = r.craftar
  s.usedKey = key
}

/** The periodic check: every local craftar workspace, the only read that may fetch (spec 60 §7.1). */
export async function periodic(): Promise<void> {
  const s = st
  if (!s) return
  const settings = await readSettings(s.orca)
  const { local } = await listRows(s.orca)
  await ensureCheck(s, settings, local, false)
  if (!s.craftar) return publish(s)
  // One workspace after another: a periodic check never starts several craftar processes at once.
  const all = (async () => {
    for (const row of local) await readWorkspace(s, row, 'periodic', settings)
  })()
  await track(s, all)
  await publish(s)
}

function schedule(s: State): void {
  void readSettings(s.orca)
    .then((settings) => {
      if (st !== s) return
      s.periodicTimer = setTimeout(() => {
        void track(s, periodic()).catch((e) => s.orca.log(failed('periodic check', e))).finally(() => {
          if (st === s) schedule(s)
        })
      }, intervalMs(settings.intervalMinutes))
      const t = s.periodicTimer as unknown as { unref?: () => void }
      if (typeof t.unref === 'function') t.unref()
    })
    .catch((e) => s.orca.log(failed('settings', e)))
}

function listed(m: PanelModel | null, path: string): boolean {
  if (!m) return false
  return [...m.pending, ...m.edited, ...m.apart].some((f) => f.path === path)
}

export default function activate(orca: OrcaWorkerApi): void {
  const startedAt = Date.now()
  const tick = (): Promise<void> => beat(orca, startedAt).catch((e) => orca.log(failed('heartbeat', e)))
  const s: State = {
    orca,
    craftar: null,
    selfCheck: [],
    focus: { kind: 'none' },
    remote: [],
    models: new Map(),
    failed: new Set(),
    queue: new Serial(),
    diff: null,
    work: new Set(),
    usedKey: null,
    periodicTimer: null,
  }
  st = s
  orca.host
    .call('statusBar.update', { id: ITEM, text: 'craftar', tooltip: 'craftar — reading', icon: 'layers' })
    .catch((e) => orca.log(failed('status bar', e)))
  firstBeat = tick()
  timer = setInterval(() => void tick(), HEARTBEAT_MS)
  if (typeof timer === 'object' && timer && 'unref' in timer) timer.unref()
  orca.commands.register('craftar.probe', () => probe(orca, startedAt))

  // One refresh at a time: Orca delivers the current context to a new subscriber, on top of the first one.
  const refresh = (ctx?: Context | null, recheck = false): Promise<void> =>
    track(s, s.queue.run(FOCUS_QUEUE, () => refreshFocus(s, ctx, recheck))).catch((e) => orca.log(failed('refresh', e)))
  orca.events.on('workspace.changed', (payload) => refresh((payload as { context: Context | null }).context))
  orca.panels.handle('state.get', async () => view(s) as never)
  orca.panels.handle('state.refresh', async () => {
    await refresh(undefined, true)
    return view(s) as never
  })
  orca.panels.handle('focus.choose', async (input) => {
    const id = (input as { id?: unknown } | undefined)?.id
    const ask = s.focus.kind === 'ask' ? s.focus.rows : []
    if (typeof id !== 'string' || !ask.some((r) => r.id === id)) throw new Error('not one of the workspaces the panel offered')
    await orca.storage.set(FOCUS_CHOICE, id)
    await refresh()
    return view(s) as never
  })
  orca.panels.handle('diff.get', async (input) => {
    const path = (input as { path?: unknown } | undefined)?.path
    const ws = focusedPath(s)
    const m = ws ? (s.models.get(ws) ?? null) : null
    if (!ws || !s.craftar || typeof path !== 'string' || !listed(m, path)) {
      return { refused: 'not a file this workspace lists — refresh the panel' } as never
    }
    if (!s.diff || s.diff.ws !== ws) s.diff = { ws, child: new DiffChild(s.craftar, ws) }
    const child = s.diff.child
    try {
      return (await s.queue.run(ws, () => child.diff(path))) as never
    } catch (e) {
      return { refused: e instanceof DiffRefused ? e.message : 'craftar mcp did not answer' } as never
    }
  })
  void refresh(undefined, true)
  schedule(s)
}

export function deactivate(): void {
  if (timer) clearInterval(timer)
  timer = null
  const s = st
  st = null
  if (s?.periodicTimer) clearTimeout(s.periodicTimer)
  if (s?.diff) void s.diff.child.stop()
}
