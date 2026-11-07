// The craftar worker. S1, the read path: the self-check on enable (spec 60 §5), the reads of the focused
// craftar workspace on every focus change (offline) and of every local one on the periodic check (the
// only read that may fetch), the panel's requests, and the status bar item that keeps the worker alive
// (§2.4, measured by the S0 probe — README). S0's probe and heartbeat stay until the terminal is measured;
// the status bar item runs the probe, whose report goes to the panel and whose outcome goes to one
// notification and the log. Nothing here writes a workspace or a Forge; only the probe opens a terminal.
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
// The status bar item runs the probe when pressed (orca-plugin.json); its tooltip says so.
const CLICK_HINT = ' · click: run the probe'
const WATCHED_ENV = ['CRAFTAR_HOME', 'SSH_AUTH_SOCK', 'GIT_AUTHOR_NAME', 'GH_TOKEN'] as const

interface Heartbeat {
  startedAt: number
  ticks: number
  last: number
}

let timer: ReturnType<typeof setInterval> | null = null
let firstBeat: Promise<void> = Promise.resolve()
// The probe in flight: a second click while it runs gets the same report, not a second terminal.
let probing: Promise<string> | null = null

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

interface TerminalResult {
  /** One line, safe to log and to notify: the outcome, never a line the terminal printed. */
  outcome: string
  /** Orca's opaque handle of the terminal, for the log only. */
  id: string | null
  /** The terminal's last lines — its prompt can carry a host name, a user name or a directory (O11). */
  lines: string[]
}

async function terminalProbe(orca: OrcaWorkerApi): Promise<TerminalResult> {
  const workspaceId = await focusedWorkspaceId(orca)
  if (!workspaceId) return { outcome: 'terminal: not opened — no single local workspace to open it in (focus one and run the probe again)', id: null, lines: [] }
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
  return {
    outcome: `terminal: ${seen ? `${PROBE_MARK} seen` : `${PROBE_MARK} not seen after 5 s`}`,
    id: terminalId,
    lines: lines.slice(-8),
  }
}

/** A craftar version as craftar prints it, else nothing: only that shape reaches the log. */
function versionShaped(line: string): string | null {
  const m = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.exec(line.trim())
  return m ? m[0] : null
}

export async function probe(orca: OrcaWorkerApi, startedAt: number): Promise<string> {
  const { settings } = (await orca.host.call('settings.get', {})) as { settings: Record<string, unknown> }
  const craftarPath = text(settings.craftarPath)
  const craftarHome = text(settings.craftarHome)
  const out: string[] = ['craftar probe — S0 (spec 60 §12)']

  // `summary` is what may be logged and notified: outcomes only, no path and no line of anyone's.
  const summary: string[] = []
  const found = findCraftar({ craftarPath, path: process.env.PATH ?? '' })
  if (found.found === null) {
    out.push(`craftar: not found — ${found.reason}`)
    summary.push('craftar not found')
  } else {
    out.push(`craftar: found at ${found.found}${found.shim ? ` (under the ${found.shim} shim directory: a project's files can choose what runs)` : ''}`)
    const r = await run(found.found, ['--version'], childEnv(process.env, craftarHome))
    const first = r.stdout.trim().split(/\r?\n/)[0] ?? ''
    out.push(r.code === 0 ? `version: ${first}` : `version: craftar --version failed (exit ${r.code ?? 'none'})`)
    const v = r.code === 0 ? versionShaped(first) : null
    summary.push(`craftar found${found.shim ? ` (${found.shim} shim)` : ''}, ${r.code === 0 ? `version ${v ?? '(not shown)'}` : `--version failed (exit ${r.code ?? 'none'})`}`)
  }
  out.push(`CRAFTAR_HOME: ${craftarHome.trim() !== '' ? 'set from the setting' : 'not set (craftar uses its default)'}`)
  out.push(`worker environment: ${WATCHED_ENV.map((k) => `${k} ${process.env[k] ? 'present' : 'absent'}`).join(', ')}`)
  // Orca's CLI is `orca-ide`; an `orca` on PATH can be another program (on GNOME, the screen reader).
  const orcaIde = findOnPath('orca-ide', process.env.PATH ?? '')
  const otherOrca = findOnPath('orca', process.env.PATH ?? '')
  out.push(
    `Orca CLI (orca-ide): ${orcaIde ? 'on an absolute PATH entry' : 'not on an absolute PATH entry'}` +
      (otherOrca ? ' — an `orca` on PATH is another program, not taken for it' : ''),
  )

  await firstBeat
  const hb = (await orca.storage.get(HEARTBEAT).catch(() => null)) as Heartbeat | null
  const upMin = Math.round((Date.now() - startedAt) / 60_000)
  out.push(`worker alive: ${upMin} min since this start${hb && hb.startedAt === startedAt ? `, ${hb.ticks} heartbeats` : ''}`)

  let terminal: TerminalResult
  try {
    terminal = await terminalProbe(orca)
  } catch (e) {
    terminal = { outcome: failed('terminal', e), id: null, lines: [] }
  }
  summary.push(terminal.outcome)
  // The log and the notification carry the summary only (the log also the terminal's opaque id): craftar's path and output, and the terminal's
  // lines — a prompt can carry a host name, a user name or a directory (spec 60 O11) — are shown in the
  // panel, to the person who ran it, and never logged or notified.
  orca.log(['probe ran', ...summary.slice(0, -1), terminal.id ? `${terminal.outcome} (terminal ${terminal.id})` : terminal.outcome].join('\n'))
  const shown = (await orca.host
    .call('notifications.show', { title: 'craftar probe', body: `${summary.join(' · ')} — the full report is in the craftar panel.` })
    .catch((e) => {
      orca.log(failed('notification', e))
      return null
    })) as { delivered?: unknown } | null
  out.push(
    `notifications.show: ${shown?.delivered === true ? 'delivered' : 'not delivered'} (host-api 1.3: a notification has no action — the panel holds the one click)`,
  )
  const report = [
    ...out,
    terminal.outcome,
    ...(terminal.lines.length > 0 ? ['  (its last lines show its prompt: which shell, which directory)'] : []),
    ...terminal.lines.map((l) => `  | ${l}`),
  ]
  const s = st
  if (s) {
    s.probe = { at: Date.now(), lines: report }
    await publish(s).catch((e) => orca.log(failed('probe publish', e)))
  }
  return report.join('\n')
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
  /** The workspace the last self-check asked doctor about; null when there was none to ask. */
  checkedWs: string | null
  periodicTimer: ReturnType<typeof setTimeout> | null
  /** The last probe report, shown in the panel; kept in memory only, never stored. */
  probe: { at: number; lines: string[] } | null
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
  probe: { at: number; lines: string[] } | null
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
    probe: s.probe,
  }
}

async function publish(s: State): Promise<void> {
  const ws = focusedPath(s)
  const broken = s.craftar === null && s.selfCheck.some((l) => l.level === 'error')
  const m = ws ? (s.models.get(ws) ?? null) : null
  const bar = barFor(broken || (ws !== null && s.failed.has(ws)) ? 'error' : m)
  const tooltip = `${ws ? `craftar — ${ws}` : 'craftar — no craftar workspace focused'}${CLICK_HINT}`
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

// Stopped in its workspace's queue, so a diff call in flight finishes first.
async function stopDiff(s: State): Promise<void> {
  const old = s.diff
  s.diff = null
  if (old) await s.queue.run(old.ws, () => old.child.stop())
}

/**
 * Runs the self-check when asked, when none ran yet, or when craftarPath or craftarHome changed — then the
 * diff child built from the old settings is stopped too (O1). doctor is asked about the focused workspace,
 * else any local one, and runs in that workspace's queue so it never overlaps a read of it.
 */
async function ensureCheck(s: State, settings: Settings, local: Row[], force: boolean): Promise<void> {
  const key = settingsKey(settings)
  const changed = s.usedKey !== null && s.usedKey !== key
  const appeared = s.checkedWs === null && local.length > 0
  if (!force && !changed && !appeared && s.selfCheck.length > 0) return
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
  s.checkedWs = ws
}

/** The periodic check: every local craftar workspace, the only read that may fetch (spec 60 §7.1). */
export async function periodic(): Promise<void> {
  const s = st
  if (!s) return
  const settings = await readSettings(s.orca)
  const { local } = await listRows(s.orca)
  // In the focus queue: never two self-checks at once, whichever path starts them.
  await s.queue.run(FOCUS_QUEUE, () => ensureCheck(s, settings, local, false))
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
    checkedWs: null,
    periodicTimer: null,
    probe: null,
  }
  st = s
  orca.host
    .call('statusBar.update', { id: ITEM, text: 'craftar', tooltip: `craftar — reading${CLICK_HINT}`, icon: 'layers' })
    .catch((e) => orca.log(failed('status bar', e)))
  firstBeat = tick()
  timer = setInterval(() => void tick(), HEARTBEAT_MS)
  if (typeof timer === 'object' && timer && 'unref' in timer) timer.unref()
  orca.commands.register('craftar.probe', () => {
    if (!probing) probing = probe(orca, startedAt).finally(() => (probing = null))
    return probing
  })

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
    try {
      // The child is built inside the queue, after any self-check of this workspace, from the craftar it left.
      return (await s.queue.run(ws, () => {
        if (!s.craftar) throw new Error('no craftar')
        if (!s.diff || s.diff.ws !== ws) s.diff = { ws, child: new DiffChild(s.craftar, ws) }
        return s.diff.child.diff(path)
      })) as never
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
  probing = null
  const s = st
  st = null
  if (s?.periodicTimer) clearTimeout(s.periodicTimer)
  if (s?.diff) void s.diff.child.stop()
}
