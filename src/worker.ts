// The craftar worker. The read path (S1): the self-check on enable (spec 60 §5), the reads of the focused
// craftar workspace on every focus change (offline) and of every local one on the periodic check (the only
// read that may fetch), the panel's requests, and the status bar item that keeps the worker alive (§2.4).
// The incoming path (S2, §7, O2): the periodic check notifies when the pending set grows; the panel's Update,
// after a confirm, syncs through craftar mcp --allow-writes and stages exactly, never committing; a consent
// refusal opens, on a click, the shell check and the allow-writes terminal where the person answers. Nothing
// else writes a workspace or a Forge. S0's probe and heartbeat stay, in the palette.
import type { OrcaWorkerApi } from 'orca/worker'
import { type Craftar, driftShow, ReadFailure, repos, status as readStatusDoc, workspaces as registryRead, type DriftDoc, type ReposDoc, type StatusDoc, type WorkspacesDoc } from './craftar'
import { afterDiscard, discardArgs, fetchFailed, pendingOf, rowFault } from './discard'
import { DiffChild, DiffRefused } from './diff-child'
import { craftarWorkspaces, focusedBy, onThisMachine, type Context, type Focus, type FocusSource, type Row } from './focus'
import { activeWorkspacePath, findOrcaCli, switchToTerminal, terminalListed, terminalWorkspacePaths } from './orca-cli'
import { barFor, buildModel, type PanelModel } from './model'
import { findCraftar, findOnPath } from './resolve'
import { childEnv, run } from './run'
import { intervalMs, readStatus, type Reason, Serial } from './scheduler'
import { type Line, selfCheck, versionAtLeast } from './self-check'
import { compareWithQuestion } from './compare'
import { findGit, StageFailed, stagePaths } from './stage'
import { syncOnce } from './sync-child'
import { promote, PromoteRefused, type PromoteResult } from './promote'
import { isAbsolute } from 'node:path'
import { createHash } from 'node:crypto'
import { allowWritesCommand, answered, detectShell, PROBE_SHELL_COMMAND, type Shell } from './shell'
import { branchFault, defaultBranch, defaultTitle, prBody, quotable, readStep, remoteHost, stepCommand, titleFault, type Step } from './forge-pr'
import { randomBytes } from 'node:crypto'

const ITEM = 'craftar'
const HEARTBEAT = 'probe.heartbeat'
const FOCUS_CHOICE = 'focus.choice'
const FETCHED_AT = 'fetchedAt'
// Per workspace path: a digest of craftar's messages the person cleared from the bell — never their text.
const CLEARED = 'messages.cleared'
// At most this many dismissed cards are remembered (memory only): an old one is forgotten first.
const DISMISSED_MAX = 200
// The queue key of the focus refresh; a workspace's key is its absolute path, which this cannot be.
const FOCUS_QUEUE = ' focus'
const HEARTBEAT_MS = 60_000
// A fixed, harmless command: no value of anyone's is put into a terminal (spec 60 §10).
const PROBE_COMMAND = 'echo craftar-probe'
const PROBE_MARK = 'craftar-probe'
// The status bar item shows or hides the right side bar, where the panel is (orca-plugin.json): Orca
// 1.4.250 gives a plugin no way to open its own panel. Its tooltip says so. The probe is in the palette.
const CLICK_HINT = ' · click: show or hide the craftar panel'
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
    workspaces: { id: string; name: string; path?: string; branch: string | null; hostId: string | null }[]
  }
  const local = workspaces.filter((w) => onThisMachine(w.hostId))
  // Orca's active workspace first, as the focus reads it (orca-cli.ts): name and branch tie.
  const cli = findOrcaCli(process.env.PATH ?? '')
  const active = cli ? await activeWorkspacePath(cli) : null
  if (active?.kind === 'one') {
    const byPath = local.find((w) => w.path === active.path)
    if (byPath) return byPath.id
  }
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
  // The worker's focus first — the one the panel shows, the person's answer to a tie included (O9):
  // readContext names a workspace by display name and branch only, which tie (in Orca 1.4.250 every
  // `main` worktree is named `main`). Its own deduction only when no craftar workspace has the focus.
  const s = st
  if (s?.focus.kind === 'ask') {
    return { outcome: 'terminal: not opened, several workspaces match the focused one: pick it in the craftar panel, then run the probe again', id: null, lines: [] }
  }
  const workspaceId = s?.focus.kind === 'one' ? s.focus.row.id : await focusedWorkspaceId(orca)
  if (!workspaceId) return { outcome: 'terminal: not opened, no single local workspace to open it in (focus one and run the probe again)', id: null, lines: [] }
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

export async function probe(orca: OrcaWorkerApi, startedAt: number, opts: { notify?: boolean } = {}): Promise<string> {
  const { settings } = (await orca.host.call('settings.get', {})) as { settings: Record<string, unknown> }
  const craftarPath = text(settings.craftarPath)
  const craftarHome = text(settings.craftarHome)
  const out: string[] = ['craftar probe, S0 (spec 60 §12)']

  // `summary` is what may be logged and notified: outcomes only, no path and no line of anyone's.
  const summary: string[] = []
  const found = findCraftar({ craftarPath, path: process.env.PATH ?? '' })
  if (found.found === null) {
    out.push(`craftar: not found (${found.reason})`)
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
  const orcaIde = findOrcaCli(process.env.PATH ?? '')
  const otherOrca = findOnPath('orca', process.env.PATH ?? '')
  // Whether Orca's CLI answers from inside the worker, where the focus is read from (never which workspace).
  const active = orcaIde ? await activeWorkspacePath(orcaIde) : null
  const activeLine = active === null ? '' : `, active workspace: ${active.kind === 'one' ? 'found' : active.kind === 'none' ? 'none' : `failed (${active.reason})`}`
  out.push(
    `Orca CLI (orca-ide): ${orcaIde ? 'on an absolute PATH entry' : 'not on an absolute PATH entry'}${activeLine}` +
      (otherOrca ? '; an `orca` on PATH is another program, not taken for it' : ''),
  )
  summary.push(`Orca CLI: ${active === null ? 'not found' : active.kind === 'one' ? 'active workspace found' : active.kind === 'none' ? 'no active workspace' : `failed (${active.reason})`}`)

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
  // From the palette the report is announced; from Validate the person is looking at the panel already.
  if (opts.notify !== false) {
    const shown = (await orca.host
      .call('notifications.show', { title: 'craftar probe', body: `${summary.join(' · ')}. The full report is in the craftar panel.` })
      .catch((e) => {
        orca.log(failed('notification', e))
        return null
      })) as { delivered?: unknown } | null
    out.push(
      `notifications.show: ${shown?.delivered === true ? 'delivered' : 'not delivered'} (host-api 1.3: a notification has no action; the panel holds the one click)`,
    )
  }
  const report = [
    ...out,
    terminal.outcome,
    ...(terminal.lines.length > 0 ? ['  (its last lines show its prompt: which shell, which directory)'] : []),
    ...terminal.lines.map((l) => `  | ${l}`),
  ]
  const s = st
  if (s) {
    // The self-check's every line (ok included) heads the report, so Validate shows both in one place.
    const checked = s.selfCheck.map((l) => `${l.level === 'ok' ? 'ok   ' : l.level === 'warn' ? 'warn ' : 'error'} ${l.message}`)
    const lines = checked.length > 0 ? ['self-check', ...checked.map((l) => `  ${l}`), '', ...report] : report
    s.probe = { at: Date.now(), lines }
    await publish(s).catch((e) => orca.log(failed('probe publish', e)))
    return lines.join('\n')
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
  /** craftar's version from the self-check (doctor --json), or null. */
  version: string | null
  /** S2, per workspace path: the sync's phase and craftar's words, the consent to give, the last sync's outcome. */
  sync: Map<string, SyncView>
  consent: Map<string, ConsentView>
  lastSync: Map<string, LastSync>
  /** Per workspace path with a remote Forge: what the last periodic read did with the fetch (O10). */
  fetchState: Map<string, 'fetched' | 'failed' | 'off'>
  /** S3a, per workspace path: the Send to Forge in progress (the dry run's plan, then the write's result). */
  send: Map<string, SendView>
  /** Per workspace path: the files craftar refused to send, with its words — kept here, no Send, until the file is saved again. */
  sendRefused: Map<string, Map<string, string>>
  /** The machine's registry and each workspace's repos, as the last read gave them: a focus read reuses them (the switch waits only for status and drift show). */
  registryDoc: WorkspacesDoc | null
  reposDocs: Map<string, ReposDoc | null>
  /** Per workspace path: every path craftar's status lists — what the save hook may mark (O7). */
  known: Map<string, Set<string>>
  /** Per workspace path: files saved since the last read, marked "edited — not yet in the Forge" (O7). */
  marked: Map<string, Set<string>>
  /** Per workspace path: the local clone of a URL Forge the person named (stored: paths only). */
  forgeDirs: Record<string, string>
  /** The local craftar workspaces by Orca id, from the last focus refresh (the save hook's lookup). */
  rowsById: Map<string, Row>
  /** A read the save hook asked for, debounced. */
  saveTimer: ReturnType<typeof setTimeout> | null
  /** The cards the person closed with ×, by the panel's key (workspace, card, craftar's words): memory only, never stored. */
  dismissed: Set<string>
  /** Per workspace path: the digest of the messages cleared from the bell (stored: digests only). */
  cleared: Record<string, string>
  /** Validate in flight: the forced self-check, then the probe. */
  validating: boolean
  /** S3b, per workspace path: the PR in the Forge after a Send (memory only). */
  forgePr: Map<string, ForgePr>
  /** Discard (spec 60 §8a), per workspace path: the confirmation, the run and its outcome (memory only). */
  discard: Map<string, DiscardState>
  /** The Forge sources whose fetches the worker holds while a discard reads and runs (the periodic check skips them). */
  discardHold: Set<string>
}

/** Discard's state for one workspace: what the confirmation showed and where the run stands. */
export interface DiscardState {
  path: string
  phase: 'confirm' | 'checking' | 'running' | 'done' | 'error'
  /** An `orphan-drift`: the discard deletes the file. */
  deleted: boolean
  /** The diff tool's text for the file, or craftar's note where it withholds the content. */
  diff: string | null
  note: string | null
  /** craftar's refusal or the plugin's reason, verbatim; a note above the confirmation when it was drawn again. */
  message: string | null
  after: { file: string; others: string[]; warnings: string[] } | null
  /** Internal: the read the confirmation came from, and that row's Forge side. */
  before?: StatusDoc
  rowForge?: string
}

/** S3b's state for one workspace: what the PR carries, where its three steps stand, and what the terminals said that is kept. */
export interface ForgePr {
  /** The PR screen is shown (false: back on the workspace, the steps waiting). */
  open: boolean
  phase: 'preparing' | 'ready' | 'committing' | 'committed' | 'pushing' | 'pushed' | 'opening' | 'opened' | 'failed' | 'words'
  /** The step that failed or still runs, and whether its terminal said nothing yet after the wait. */
  step: Step | null
  waiting: boolean
  /** The Forge's folder, and the paths craftar wrote there (relative to it). */
  forge: string
  paths: string[]
  branch: string
  title: string
  body: string
  /** The identity git uses in this workspace's terminals, and the Forge's branch before the new one. */
  identity: string | null
  forgeBranch: string | null
  /** The commit's author when it differs from the identity shown. */
  authorDiffers: string | null
  url: string | null
  attached: boolean | null
  /** The steps in words when no terminal can be opened (a shell the plugin does not quote for). */
  steps: string[]
  note: string | null
  /** Internal: the marker nonce and the terminal of the step that runs, and the Forge remote's host. */
  nonce?: string
  terminalId?: string
  host?: string | null
}

export interface SendView {
  path: string
  phase: 'checking' | 'preview' | 'writing' | 'done' | 'error'
  /** The dry run's plan: what craftar would write in the Forge. */
  plan: PromoteResult | null
  /** The write's result. */
  result: PromoteResult | null
  /** craftar's refusal, verbatim, or the plugin's own reason. */
  message: string | null
  /** The Forge clone the dry run used (null for a local Forge): the write uses the same one. */
  forge?: string | null
  /** Which run this is: a late result of an older run is dropped. */
  token?: number
}

let sendToken = 0

export interface SyncView {
  phase: 'idle' | 'running' | 'consent' | 'done' | 'error'
  message: string | null
}

export interface ConsentView {
  /** craftar's refusal, verbatim. */
  text: string
  /** The allow-writes terminal already opened for this consent, brought forward again on the next click. */
  terminalId?: string
  /** Where the terminal is when Orca's CLI could not bring it forward; drawn beside the button. */
  note?: string | null
  /** 'offered': the panel offers a terminal running craftar mcp allow-writes; 'words': the steps are shown as text only. */
  terminal: 'offered' | 'words'
  steps: string[]
}

export interface LastSync {
  written: string[]
  removed: { path: string; reason: string }[]
  kept: { path: string; state: string; reason: string }[]
  staged: string[]
  leftOut: string[]
  differences: string[]
  warnings: string[]
  rerun: boolean
}

export interface UpdateView {
  allowed: boolean
  reason: string | null
  files: { path: string; state: string }[]
}

const IDLE: SyncView = { phase: 'idle', message: null }

// The first craftar with the writing tools of craftar mcp (craftar-cli 0.35.0, spec 40).
const WRITES_FLOOR = '0.35.0'

/** Why Update could not run on this workspace whatever is pending, or null (O10) — shared by Update and the notification. */
function blockedReason(s: State, ws: string, m: PanelModel | null): string | null {
  if (s.failed.has(ws)) return 'craftar status gave no document for this workspace: nothing to update from'
  if (!m) return 'no craftar workspace has the focus'
  if (!s.version || !versionAtLeast(s.version, WRITES_FLOOR)) return `updating needs craftar ${WRITES_FLOOR} or later: upgrade craftar`
  if (m.refused) return 'craftar refuses to sync this workspace (see its words above)'
  if (m.checkFailed) return 'craftar status failed for this workspace (see its lines above)'
  if (m.forge && m.forge.freshness !== 'local') {
    const f = s.fetchState.get(ws)
    if (f === 'off') return '"Fetch a remote Forge" is off: updating needs a fetched read. Turn it on in the plugin settings'
    if (f === 'failed') return 'the Forge could not be fetched: this is the cached copy, and updating waits for a fetch that works'
    if (f !== 'fetched') return 'the Forge has not been fetched yet: the next periodic check fetches it'
  }
  return null
}

/** Whether Update may run for the focused workspace, and why not (spec 60 §7 step 1, O10). */
function updateView(s: State): UpdateView {
  const ws = focusedPath(s)
  const m = ws ? (s.models.get(ws) ?? null) : null
  const files = m ? m.pending.map((f) => ({ path: f.path, state: f.state })) : []
  const no = (reason: string): UpdateView => ({ allowed: false, reason, files })
  if (!ws) return no('no craftar workspace has the focus')
  const blocked = blockedReason(s, ws, m)
  if (blocked) return no(blocked)
  if (files.length === 0) return no('nothing to update')
  if (s.sync.get(ws)?.phase === 'running') return no('an update is running')
  return { allowed: true, reason: null, files }
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
    // O10: only the periodic read fetches; an offline focus read says nothing about a failed fetch.
    const remote = status.forge?.kind !== undefined && status.forge.kind !== 'path'
    if (remote && reason === 'periodic') s.fetchState.set(row.path, !settings.fetch ? 'off' : status.forge?.fetched === true ? 'fetched' : 'failed')
    if (!remote) s.fetchState.delete(row.path)
    const errors: string[] = []
    const fetched = await fetchedAtMap(s.orca)
    if (status.forge?.fetched === true) {
      fetched[row.path] = Date.now()
      await s.orca.storage.set(FETCHED_AT, fetched)
    }
    const drift: DriftDoc | null = await optional('drift show', driftShow(craftar, row.path), errors)
    // A focus read asks only status and drift show when an earlier read gave the rest: `workspaces` plans every registered
    // workspace and grows with the machine, and neither it nor `repos` draws anything the switch needs. The periodic read refreshes both.
    const reuse = reason === 'focus' && s.registryDoc !== null && s.reposDocs.has(row.path)
    const rp: ReposDoc | null = reuse ? (s.reposDocs.get(row.path) ?? null) : await optional('repos', repos(craftar, row.path), errors)
    const cached = reuse ? s.registryDoc : null
    // A reused registry speaks for this workspace as of its read: its own `<ws>: …` lines are left out, since status
    // and drift show just said them fresh. Every other line stays.
    const registry: WorkspacesDoc | null = cached
      ? { ...cached, warnings: cached.warnings.filter((w) => !w.startsWith(`${row.path}: `)) }
      : await optional('workspaces', registryRead(craftar), errors)
    // Only a document craftar gave is kept: after a failure the next focus read asks again, and says so.
    if (!reuse) {
      if (rp) s.reposDocs.set(row.path, rp)
      else s.reposDocs.delete(row.path)
      s.registryDoc = registry
    }
    const model = buildModel({ ws: row.path, name: row.name, status, drift, repos: rp, registry, fetchedAt: fetched[row.path] ?? null, readAt: Date.now(), errors })
    // An offline read of a remote Forge reads the copy the last periodic check fetched: when that fetch
    // worked, the copy is the fetched one, not a fallback (O10) — the panel labels and gates on it.
    if (model.forge && model.forge.freshness === 'cached' && s.fetchState.get(row.path) === 'fetched') model.forge.freshness = 'fetched'
    s.models.set(row.path, model)
    // The lock records every file but a `new` one (spec 60 §8 step 1: a path the lock records).
    s.known.set(row.path, new Set(status.statuses.filter((x) => x.state !== 'new').map((x) => x.path)))
    // drift show is the source of truth: a read replaces what the save hook marked.
    s.marked.delete(row.path)
    // A refusal of a file no longer edited by hand is no longer a question.
    const refused = s.sendRefused.get(row.path)
    if (refused) for (const p of [...refused.keys()]) if (!model.edited.some((x) => x.path === p)) refused.delete(p)
    await notifyEdited(s, model)
    // Nothing left to update: a consent asked for an earlier Update is no longer the question.
    if (model.pending.length === 0 && s.consent.has(row.path)) {
      s.consent.delete(row.path)
      if (s.sync.get(row.path)?.phase === 'consent') s.sync.delete(row.path)
    }
    await notifyGrowth(s, model, reason)
  })
}

const NOTIFIED = 'notified'

/**
 * O3/O4: one notification when a workspace's pending set grows past the count the periodic check last saw.
 * Only the periodic check counts and notifies (a focus read changes neither). Names and counts only; storage
 * holds, per workspace path, the count and a timestamp. A smaller count is stored too, so the next growth
 * notifies again.
 */
async function notifyGrowth(s: State, m: PanelModel, reason: Reason): Promise<void> {
  if (reason !== 'periodic') return
  // Not for a workspace Update could not run on: the notification's question would get a disabled button.
  if (blockedReason(s, m.ws, m) !== null) return
  const seen = ((await s.orca.storage.get(NOTIFIED).catch(() => null)) as Record<string, { count: number; at: number }> | null) ?? {}
  const before = typeof seen[m.ws]?.count === 'number' ? seen[m.ws].count : 0
  const now = m.pending.length
  if (now === before) return
  seen[m.ws] = { count: now, at: Date.now() }
  await s.orca.storage.set(NOTIFIED, seen).catch((e) => s.orca.log(failed('storage', e)))
  if (now < before) return
  const files = now === 1 ? '1 file' : `${now} files`
  const forge = m.forge?.source ? `Forge ${m.forge.source}` : 'The Forge'
  const body = `${forge} changed ${files} for ${m.name}: update ${files} and add ${now === 1 ? 'it' : 'them'} to the commit? Open the craftar panel.`
  await s.orca.host.call('notifications.show', { title: 'craftar', body }).catch((e) => s.orca.log(failed('notification', e)))
}

function forgeIsRemote(s: State, ws: string | null): boolean {
  const m = ws ? s.models.get(ws) : undefined
  return !!m?.forge && m.forge.freshness !== 'local'
}

const FORGE_DIRS = 'forge.dir'

/** A path from Orca's save event, as craftar names it: relative POSIX under `root`, or null outside it. */
function relativeTo(root: string, path: string): string | null {
  const p = path.replace(/\\/g, '/')
  if (!isAbsolute(path)) return p.replace(/^\.\//, '')
  const r = root.replace(/\\/g, '/').replace(/\/+$/, '')
  return p.startsWith(`${r}/`) ? p.slice(r.length + 1) : null
}

/** One read a second after the last save the hook marked: a burst of saves asks once. */
function scheduleRead(s: State, read: () => unknown): void {
  if (s.saveTimer) clearTimeout(s.saveTimer)
  s.saveTimer = setTimeout(() => {
    s.saveTimer = null
    void read()
  }, 1_000)
  const t = s.saveTimer as unknown as { unref?: () => void }
  if (typeof t.unref === 'function') t.unref()
}
const NOTIFIED_EDITED = 'notified.edited'

/**
 * O7 / spec 60 §8 step 2: one notification per newly edited file craftar can send up. Storage holds, per
 * workspace path, the edited paths already notified — paths only; a file no longer edited leaves the list.
 */
async function notifyEdited(s: State, m: PanelModel): Promise<void> {
  let all: Record<string, string[]>
  try {
    all = ((await s.orca.storage.get(NOTIFIED_EDITED)) as Record<string, string[]> | null) ?? {}
  } catch {
    return // a storage that does not read: no notification rather than every one again
  }
  const before = new Set(Array.isArray(all[m.ws]) ? all[m.ws] : [])
  const now = m.edited.filter((e) => e.promotable).map((e) => e.path)
  const fresh = now.filter((p) => !before.has(p))
  if (fresh.length === 0 && now.length === before.size) return
  all[m.ws] = now
  await s.orca.storage.set(NOTIFIED_EDITED, all).catch((e) => s.orca.log(failed('storage', e)))
  const forge = m.forge?.source ? `Forge ${m.forge.source}` : 'the Forge'
  for (const p of fresh) {
    await s.orca.host
      .call('notifications.show', { title: 'craftar', body: `${p} belongs to ${forge}: send the change to the Forge? Open the craftar panel.` })
      .catch((e) => s.orca.log(failed('notification', e)))
  }
}

/** The promotable edited row of the focused workspace, or a refusal in words. */
function sendable(s: State, path: unknown): { ws: string; path: string } {
  const ws = focusedPath(s)
  const m = ws ? (s.models.get(ws) ?? null) : null
  if (!ws || !m || typeof path !== 'string' || !m.edited.some((e) => e.path === path && e.promotable)) {
    throw new Error('not a file this workspace can send to the Forge: check again')
  }
  if (forgeIsRemote(s, ws) && !s.forgeDirs[ws]) throw new Error('this Forge is a git URL: name a local clone of the Forge in the panel first')
  if (!s.craftar) throw new Error('craftar is not ready (see the self-check)')
  refuseWhileBusy(s, ws)
  return { ws, path }
}

/** One send at a time per workspace: nothing changes it while craftar checks or writes. */
function refuseWhileBusy(s: State, ws: string): void {
  const now = s.send.get(ws)?.phase
  if (now === 'checking' || now === 'writing') throw new Error('craftar is already working on a send for this workspace: wait for it')
}

/** --forge only for a URL Forge (O5): a Forge on this machine needs nothing. */
function forgeFor(s: State, ws: string): string | null {
  return forgeIsRemote(s, ws) ? (s.forgeDirs[ws] ?? null) : null
}

/** The dry run (spec 60 §8 step 3): craftar proves the change and shows the plan; nothing is written. */
async function sendPreview(s: State, path: unknown): Promise<() => Promise<void>> {
  const t = sendable(s, path)
  const craftar = s.craftar as Craftar
  const token = ++sendToken
  const forge = forgeFor(s, t.ws)
  s.send.set(t.ws, { path: t.path, phase: 'checking', plan: null, result: null, message: null, forge, token })
  return () => sendPreviewRun(s, t, craftar, forge, token)
}

/** Records craftar's refusal of one file: the panel keeps it here, in craftar's words, with no Send. */
function refuseSend(s: State, ws: string, path: string, message: string): void {
  const m = s.sendRefused.get(ws) ?? new Map<string, string>()
  m.set(path, message)
  s.sendRefused.set(ws, m)
}

/** Sets a send's state only while it is still the run that started it (a Cancel or a newer run wins). */
function setIfCurrent(s: State, ws: string, token: number, next: SendView): void {
  if (s.send.get(ws)?.token === token) s.send.set(ws, next)
}

async function sendPreviewRun(s: State, t: { ws: string; path: string }, craftar: Craftar, forge: string | null, token: number): Promise<void> {
  await s.queue.run(t.ws, async () => {
    try {
      const plan = await promote(craftar, t.ws, t.path, { dryRun: true, forge })
      setIfCurrent(s, t.ws, token, { path: t.path, phase: 'preview', plan, result: null, message: null, forge, token })
    } catch (e) {
      if (e instanceof PromoteRefused && s.send.get(t.ws)?.token === token) {
        // craftar's refusal is an answer, not a screen to be stuck on: back to the workspace, the file kept here with craftar's words.
        refuseSend(s, t.ws, t.path, e.message)
        s.send.delete(t.ws)
      } else setIfCurrent(s, t.ws, token, { path: t.path, phase: 'error', plan: null, result: null, message: e instanceof PromoteRefused ? e.message : 'craftar drift promote did not run', forge, token })
    }
  })
  await publish(s)
}

/** The write, on the second click, only after the dry run of the same file: craftar writes the Forge's working tree, never a commit. */
async function sendRun(s: State, path: unknown): Promise<() => Promise<void>> {
  const t = sendable(s, path)
  const prev = s.send.get(t.ws)
  if (!prev || prev.phase !== 'preview' || prev.path !== t.path) throw new Error('look at the plan first: click Send to Forge for this file')
  const craftar = s.craftar as Craftar
  s.send.set(t.ws, { ...prev, phase: 'writing' })
  return () => sendWrite(s, t, prev, craftar)
}

async function sendWrite(s: State, t: { ws: string; path: string }, prev: SendView, craftar: Craftar): Promise<void> {
  await s.queue.run(t.ws, async () => {
    try {
      // The Forge the dry run used, whatever was named since (a changed folder drops the plan anyway).
      const result = await promote(craftar, t.ws, t.path, { dryRun: false, forge: prev.forge ?? null })
      setIfCurrent(s, t.ws, prev.token ?? -1, { ...prev, phase: 'done', result, message: null })
    } catch (e) {
      if (e instanceof PromoteRefused) refuseSend(s, t.ws, t.path, e.message)
      setIfCurrent(s, t.ws, prev.token ?? -1, { ...prev, phase: 'error', result: null, message: e instanceof PromoteRefused ? e.message : 'craftar drift promote did not run' })
    }
  })
  // Read again the workspace that was written, whichever has the focus now.
  const row = [...s.rowsById.values()].find((r) => r.path === t.ws)
  if (row) await readWorkspace(s, row, 'focus', await readSettings(s.orca))
  await publish(s)
}

export interface View {
  focus: Focus['kind']
  selfCheck: Line[]
  model: PanelModel | null
  readFailed: boolean
  ask: { id: string; name: string; path: string }[]
  remote: { name: string; path: string }[]
  probe: { at: number; lines: string[] } | null
  update: UpdateView
  sync: SyncView
  consent: ConsentView | null
  lastSync: LastSync | null
  send: SendView | null
  /** A URL Forge needs a local clone named once per workspace (O5); a local Forge needs nothing. */
  forgeDir: { needed: boolean; dir: string | null }
  marked: string[]
  /** The files craftar refused to send, in its words: the panel shows them kept here, with no Send. */
  sendRefused: { path: string; message: string }[]
  /** The keys of the cards closed with × (this run of the worker only). */
  dismissed: string[]
  /** The bell's messages were cleared and craftar has said nothing different since. */
  messagesCleared: boolean
  /** Validate is running (the self-check, then the probe). */
  validating: boolean
  /** S3b: the PR in the Forge, for the focused workspace. */
  forgePr: Omit<ForgePr, 'nonce' | 'terminalId' | 'host'> | null
  /** Discard of a hand edit, for the focused workspace. */
  discard: Omit<DiscardState, 'before' | 'rowForge'> | null
}

/** craftar's words for this workspace, as the bell lists them: its warnings, its errors and its refusals to send. */
function craftarWords(s: State, ws: string): string[] {
  const m = s.models.get(ws)
  const refused = [...(s.sendRefused.get(ws) ?? new Map<string, string>())].map(([p, msg]) => `${p}: ${msg}`)
  // Every line the bell lists, so a different refusal, self-check failure or failed update brings them back.
  const unset = (m?.unset ?? []).map((u) => `unset ${u.key} ${u.declaredBy.join(',')} ${u.citedBy.join(',')}`)
  const checks = s.selfCheck.filter((l) => l.level !== 'ok').map((l) => `${l.level} ${l.message}`)
  const sync = s.sync.get(ws)
  const failedSync = sync?.phase === 'error' && sync.message ? [sync.message] : []
  return [...(m?.warnings ?? []), ...(m?.errors ?? []), ...refused, ...unset, ...checks, ...failedSync]
}

/** A digest of the bell's messages for a workspace: what is stored when the person clears them, never the text. */
export function messagesDigest(ws: string, words: string[]): string {
  return createHash('sha256').update([ws, ...[...words].sort()].join('\0')).digest('hex')
}

function cleared(s: State, ws: string | null): boolean {
  if (!ws) return false
  const words = craftarWords(s, ws)
  return words.length > 0 && s.cleared[ws] === messagesDigest(ws, words)
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
    update: updateView(s),
    sync: (ws ? s.sync.get(ws) : undefined) ?? IDLE,
    consent: ws ? (s.consent.get(ws) ?? null) : null,
    lastSync: ws ? (s.lastSync.get(ws) ?? null) : null,
    send: ws ? (s.send.get(ws) ?? null) : null,
    forgeDir: { needed: forgeIsRemote(s, ws), dir: ws ? (s.forgeDirs[ws] ?? null) : null },
    marked: ws ? [...(s.marked.get(ws) ?? [])].sort() : [],
    sendRefused: ws ? [...(s.sendRefused.get(ws) ?? new Map<string, string>())].map(([path, message]) => ({ path, message })).sort((a, b) => a.path.localeCompare(b.path)) : [],
    dismissed: [...s.dismissed],
    messagesCleared: cleared(s, ws),
    validating: s.validating,
    forgePr: ws ? shownForgePr(s.forgePr.get(ws)) : null,
    discard: ws ? shownDiscard(s.discard.get(ws)) : null,
  }
}

function shownDiscard(d: DiscardState | undefined): View['discard'] {
  if (!d) return null
  const { before: _b, rowForge: _r, ...shown } = d
  return shown
}

function shownForgePr(f: ForgePr | undefined): View['forgePr'] {
  if (!f) return null
  const { nonce: _n, terminalId: _t, host: _h, ...shown } = f
  return shown
}

// S3b's terminal reads: every second, for at most 5 minutes (a push or gh can wait on a credential prompt). Tests shorten them.
let STEP_POLL_MS = 1_000
let STEP_WAIT_MS = 300_000
let nonceOf = (): string => randomBytes(4).toString('hex')
export function __forgePrTiming(poll: number, wait: number, nonce?: () => string): void {
  STEP_POLL_MS = poll
  STEP_WAIT_MS = wait
  if (nonce) nonceOf = nonce
}

const NEXT: Record<Step, ForgePr['phase']> = { prepare: 'ready', commit: 'committed', push: 'pushed', pr: 'opened' }
const RUNNING: Record<Step, ForgePr['phase']> = { prepare: 'preparing', commit: 'committing', push: 'pushing', pr: 'opening' }

/** The steps in words (no command to paste) for a terminal the plugin cannot open (spec 60 §10). */
function forgePrSteps(f: ForgePr): string[] {
  return [
    "No terminal was opened: the plugin does not recognise this terminal's shell, or cannot quote a command for it yet (cmd).",
    `In a terminal, in the Forge's folder (${f.forge}), check the identity git will use for the commit.`,
    `Create the branch ${f.branch}, add and commit exactly these paths: ${f.paths.join(', ')}.`,
    `Push the branch to origin, then open a pull request titled: ${f.title}`,
  ]
}

/** Runs one step in a new visible terminal and follows it by its marker. The worker itself never commits. */
async function runForgePrStep(s: State, ws: string, step: Step): Promise<void> {
  const f = s.forgePr.get(ws)
  const row = [...s.rowsById.values()].find((r) => r.path === ws)
  if (!f || !row) return
  let shell: Shell
  try {
    shell = await shellOf(s, row.id)
  } catch (e) {
    s.orca.log(failed('forge PR shell', e))
    s.forgePr.set(ws, { ...f, phase: 'failed', step, note: 'No terminal could be opened for this step: try it again, or drop the steps left.' })
    return publish(s)
  }
  if (!quotable(shell)) {
    s.forgePr.set(ws, { ...f, phase: 'words', step, steps: forgePrSteps(f) })
    return publish(s)
  }
  const nonce = nonceOf()
  const command = stepCommand(shell, step, { forge: f.forge, nonce, branch: f.branch, title: f.title, body: f.body, paths: f.paths })
  if (command === null) {
    s.forgePr.set(ws, { ...f, phase: 'failed', step, note: 'A value cannot go into a terminal command (the branch, the title, the Forge folder or a path holds a character a command cannot carry): drop the steps left and finish in a terminal.' })
    return publish(s)
  }
  let terminalId: string
  try {
    ;({ terminalId } = (await s.orca.host.call('terminal.create', { workspaceId: row.id, title: `craftar forge PR: ${step}`, command })) as { terminalId: string })
  } catch (e) {
    s.orca.log(failed('forge PR terminal', e))
    s.forgePr.set(ws, { ...f, phase: 'failed', step, note: 'No terminal could be opened for this step: try it again, or drop the steps left.' })
    return publish(s)
  }
  const cli = findOrcaCli(process.env.PATH ?? '')
  const shown = cli ? await switchToTerminal(cli, terminalId) : false
  s.forgePr.set(ws, {
    ...f, phase: RUNNING[step], step, waiting: false, nonce, terminalId,
    note: shown ? null : `A terminal titled "craftar forge PR: ${step}" was opened in this workspace, in the background. Switch to it in Orca's terminal tabs.`,
  })
  await publish(s)
  void track(s, followForgePrStep(s, ws, step, nonce, terminalId))
}

/** Reads the step's terminal until its marker, for at most STEP_WAIT_MS; only the identity, the branch and the PR URL are kept. */
async function followForgePrStep(s: State, ws: string, step: Step, nonce: string, terminalId: string): Promise<void> {
  const started = Date.now()
  for (;;) {
    const f = s.forgePr.get(ws)
    if (!f || f.nonce !== nonce) return
    let lines: string[] = []
    try {
      lines = ((await s.orca.host.call('terminal.read', { terminalId, maxLines: 60 })) as { lines: string[] }).lines
    } catch (e) {
      s.orca.log(failed('forge PR terminal', e))
    }
    const r = readStep(lines, step, nonce, f.host ?? null)
    if (r.done !== null) {
      const next: ForgePr = { ...f, waiting: false }
      if (r.done === 'failed') {
        next.phase = 'failed'
        next.note = step === 'commit'
          ? 'The commit step failed: its terminal says why, in git\'s words. If the branch was created before the failure, trying again fails on it: delete the branch in the Forge, or finish the commit there, then drop the steps left.'
          : `The ${step} step failed: its terminal says why. Fix it there, then try the step again.`
      } else {
        next.phase = NEXT[step]
        next.step = null
        next.note = null
        if (step === 'prepare') {
          next.identity = r.identity
          next.forgeBranch = r.branch
          // No commit before the identity it will use is shown.
          if (!r.identity) {
            next.phase = 'failed'
            next.step = 'prepare'
            next.note = 'The identity git will use was not read from the terminal: check the terminal "craftar forge PR: prepare", then try the preview again.'
          }
        }
        if (step === 'commit' && r.identity && f.identity && r.identity !== f.identity) next.authorDiffers = r.identity
        if (step === 'pr') {
          next.url = r.url
          next.attached = r.url ? await attachUrl(ws, r.url) : null
          if (!r.url) next.note = "gh opened the PR, but its URL was not read from the terminal: copy it from there."
        }
      }
      // Dropped while the URL was being attached: nothing comes back.
      if (s.forgePr.get(ws)?.nonce !== nonce) return
      s.forgePr.set(ws, next)
      return publish(s)
    }
    if (Date.now() - started >= STEP_WAIT_MS) {
      s.forgePr.set(ws, { ...f, waiting: true, note: `The terminal "craftar forge PR: ${step}" has not finished: it may wait for your answer there. Check the terminal again after it.` })
      return publish(s)
    }
    await new Promise((res) => setTimeout(res, STEP_POLL_MS))
  }
}

/** The PR URL attached to the Orca workspace (orca-ide reference add, a child with an argument array): whether it worked. */
async function attachUrl(ws: string, url: string): Promise<boolean> {
  const cli = findOrcaCli(process.env.PATH ?? '')
  if (!cli) return false
  const r = await run(cli.bin, ['reference', 'add', url, '--worktree', `path:${ws}`, '--json'], cli.env, 10_000)
  return r.code === 0
}

/** The Forge's origin host (for the PR URL check), asked of git as a child; null when it cannot be read. */
async function originHost(forge: string): Promise<string | null> {
  const git = findGit(process.env.PATH ?? '')
  if (!git) return null
  const r = await run(git.bin, ['-C', forge, 'remote', 'get-url', 'origin'], git.env, 10_000)
  return r.code === 0 ? remoteHost(r.stdout.trim()) : null
}

async function publish(s: State): Promise<void> {
  const ws = focusedPath(s)
  const broken = s.craftar === null && s.selfCheck.some((l) => l.level === 'error')
  const m = ws ? (s.models.get(ws) ?? null) : null
  const bar = barFor(broken || (ws !== null && s.failed.has(ws)) ? 'error' : m)
  const tooltip = `${ws ? `craftar: ${ws}` : 'craftar: no craftar workspace focused'}${CLICK_HINT}`
  await s.orca.host.call('statusBar.update', { id: ITEM, text: bar.text, tone: bar.tone, tooltip, icon: 'package' }).catch((e) => s.orca.log(failed('status bar', e)))
  s.orca.panels.post('state.changed', view(s) as never)
}

/** What Orca's CLI says about the focus (orca-cli.ts); with no `orca-ide` on an absolute PATH entry, nothing. */
async function focusSource(ctx: Context | null): Promise<FocusSource> {
  const cli = findOrcaCli(process.env.PATH ?? '')
  if (!cli) return { active: { kind: 'failed', reason: 'orca-ide not found' }, terminalPaths: null }
  const active = await activeWorkspacePath(cli)
  // A CLI that did not finish is not asked again in the same refresh: the focus would wait twice.
  if (active.kind === 'one' || (active.kind === 'failed' && active.reason === 'did not finish')) return { active, terminalPaths: null }
  const ids = (ctx?.terminals ?? []).map((t) => t.id).filter((id) => typeof id === 'string')
  return { active, terminalPaths: await terminalWorkspacePaths(cli, ids) }
}

async function refreshFocus(s: State, ctx?: Context | null, recheck = false): Promise<void> {
  const startedSwitch = Date.now()
  const settings = await readSettings(s.orca)
  const { local, remote } = await listRows(s.orca)
  s.remote = remote
  s.rowsById = new Map(local.map((r) => [r.id, r]))
  const context = ctx !== undefined ? ctx : ((await s.orca.host.call('workspace.readContext', {})) as Context | null)
  const stored = (await s.orca.storage.get(FOCUS_CHOICE).catch(() => null)) as string | null
  const before = focusedPath(s)
  s.focus = focusedBy(await focusSource(context), context, local, typeof stored === 'string' ? stored : null)
  const ws = focusedPath(s)
  if (s.diff && s.diff.ws !== ws) await stopDiff(s)
  // The switch first: the panel shows the new workspace at once, from its last read, while craftar reads it again.
  // The self-check runs before only when none ran yet or the settings changed (the reads need its craftar).
  const checked = await ensureCheck(s, settings, local, false)
  if (before !== ws) await publish(s)
  const shownAt = Date.now()
  if (s.focus.kind === 'one') await readWorkspace(s, s.focus.row, 'focus', settings)
  await publish(s)
  // Numbers only: how long a switch took to show and to read, for the live run.
  if (before !== ws) s.orca.log(`focus switch: shown in ${shownAt - startedSwitch} ms, read in ${Date.now() - startedSwitch} ms`)
  // A new focus or Check again re-asks doctor about the workspace in focus — after the read, so the switch never waits
  // for it, and skipped when the focus moved on in the meantime.
  if (!checked && (recheck || before !== ws)) {
    void track(s, s.queue.run(FOCUS_QUEUE, async () => {
      if (focusedPath(s) !== ws) return
      // The settings as they are now: a change during the read is the one this check is for.
      await ensureCheck(s, await readSettings(s.orca), local, true)
      await publish(s)
    })).catch((e) => s.orca.log(failed('self-check', e)))
  }
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
async function ensureCheck(s: State, settings: Settings, local: Row[], force: boolean): Promise<boolean> {
  const key = settingsKey(settings)
  const changed = s.usedKey !== null && s.usedKey !== key
  const appeared = s.checkedWs === null && local.length > 0
  if (!force && !changed && !appeared && s.selfCheck.length > 0) return false
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
  // Another craftar may answer differently: refusals given by the previous one are not kept as this one's.
  // A failed check (no version) says nothing about the craftar, so it clears nothing.
  if (s.version !== null && r.version != null && r.version !== s.version) s.sendRefused.clear()
  s.version = r.version ?? null
  s.usedKey = key
  s.checkedWs = ws
  return true
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
    for (const row of local) {
      // A discard holds its Forge's fetches from its last read to the end of its run (spec 60 §8a item 4).
      const src = s.models.get(row.path)?.forge?.source
      if (src && s.discardHold.has(src)) continue
      await readWorkspace(s, row, 'periodic', settings)
    }
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

/**
 * Update (spec 60 §7 steps 3–4, O2): in the workspace's queue, the one sync through craftar mcp
 * --allow-writes --fetch; on success exact staging, the source-control view shown, the result compared with
 * the list the person agreed to; then the workspace is read again, offline. A consent or another refusal
 * writes nothing and is shown in craftar's words.
 */
async function runUpdate(s: State, asked: { path: string; state: string }[]): Promise<void> {
  const ws = focusedPath(s)
  const row = s.focus.kind === 'one' ? s.focus.row : null
  const craftar = s.craftar
  if (!ws || !row || !craftar) return
  s.sync.set(ws, { phase: 'running', message: null })
  s.consent.delete(ws)
  // The last update shown belongs to this run only: an older one never sits under a new error.
  s.lastSync.delete(ws)
  await publish(s)
  await s.queue.run(ws, async () => {
   try {
    const outcome = await syncOnce(craftar, ws)
    if (outcome.kind === 'consent') {
      s.sync.set(ws, { phase: 'consent', message: outcome.text })
      const known = (await s.orca.storage.get(SHELL_KEY).catch(() => null)) as Shell | null
      const home = (await readSettings(s.orca)).craftarHome
      s.consent.set(ws, { text: outcome.text, terminal: known === 'cmd' || known === 'unknown' ? 'words' : 'offered', steps: consentSteps(ws, craftar, home, known === 'cmd' || known === 'unknown' ? NO_TERMINAL : null) })
      return
    }
    if (outcome.kind !== 'ok') {
      s.sync.set(ws, { phase: 'error', message: outcome.text })
      return
    }
    const r = outcome.result
    const cmp = compareWithQuestion(asked, r)
    let staged: string[] = []
    let leftOut: string[] = []
    let stageError: string | null = null
    const git = findGit(process.env.PATH ?? '')
    if (!git) stageError = 'git was not found on an absolute PATH entry: nothing was staged'
    else {
      try {
        ;({ staged, leftOut } = await stagePaths(git, ws, r))
      } catch (e) {
        stageError = e instanceof StageFailed ? `${e.message}; nothing more was staged` : 'staging did not run'
      }
    }
    s.lastSync.set(ws, { written: r.written, removed: r.removed, kept: r.skipped, staged, leftOut, differences: cmp.differences, warnings: r.warnings, rerun: cmp.rerun })
    s.sync.set(ws, { phase: stageError ? 'error' : 'done', message: stageError })
    if (staged.length > 0) await s.orca.host.call('commands.run', { action: 'sidebar.sourceControl.toggle' }).catch((e) => s.orca.log(failed('source control', e)))
   } catch (e) {
    // Never left 'running': an unexpected failure is said in fixed words, and nothing more is done.
    s.orca.log(failed('update', e))
    s.sync.set(ws, { phase: 'error', message: 'the update stopped on an unexpected error: nothing more was done; see the plugin log' })
   }
  })
  const settings = await readSettings(s.orca)
  await readWorkspace(s, row, 'focus', settings)
  await publish(s)
}

const NO_TERMINAL = "No terminal was opened: the plugin does not recognise this terminal's shell, or cannot quote a command for it yet (cmd)."

// The shell this machine's terminals run, as the probe found it (O12); one answer per host — S2 is local only.
const SHELL_KEY = 'shell.local'

/** The shell of a new terminal in the workspace: the stored answer, else the probe's, which is then stored. */
async function shellOf(s: State, workspaceId: string): Promise<Shell> {
  const known = (await s.orca.storage.get(SHELL_KEY).catch(() => null)) as Shell | null
  if (known) return known
  const { terminalId } = (await s.orca.host.call('terminal.create', { workspaceId, title: 'craftar shell check', command: PROBE_SHELL_COMMAND })) as {
    terminalId: string
  }
  let shell: Shell = 'unknown'
  let seen = false
  for (let i = 0; i < 20 && !seen; i++) {
    const { lines } = (await s.orca.host.call('terminal.read', { terminalId, maxLines: 40 })) as { lines: string[] }
    seen = answered(lines)
    shell = detectShell(lines)
    if (!seen) await new Promise((r) => setTimeout(r, 250))
  }
  // Only an answer is stored: a terminal that printed none yet (a slow shell start) is probed again next time.
  if (seen) await s.orca.storage.set(SHELL_KEY, shell).catch((e) => s.orca.log(failed('storage', e)))
  return shell
}

/**
 * O2: a terminal in the focused workspace running the person's craftar `mcp allow-writes --workspace <dir>`,
 * quoted for its shell; the person reads what it allows and answers its [no] question. Never sendText. A
 * shell the probe does not recognise (or cmd, S4) gets no terminal: the steps stay in words.
 */
let consentBusy = false

async function openConsentTerminal(s: State): Promise<void> {
  // One at a time: a double click opens one shell check and one allow-writes terminal, not two.
  if (consentBusy) return
  consentBusy = true
  try {
    await openConsentTerminalOnce(s)
  } finally {
    consentBusy = false
  }
}

async function openConsentTerminalOnce(s: State): Promise<void> {
  const row = s.focus.kind === 'one' ? s.focus.row : null
  const craftar = s.craftar
  // The consent is the focused workspace's own: one asked for another workspace opens nothing here.
  const consent = row ? s.consent.get(row.path) : undefined
  if (!consent || !row || !craftar) throw new Error('nothing to allow: run Update first')
  const shell = await shellOf(s, row.id)
  const settings = await readSettings(s.orca)
  const command = allowWritesCommand(shell, { bin: craftar.bin, home: settings.craftarHome }, row.path)
  if (command === null) {
    s.consent.set(row.path, { ...consent, terminal: 'words', steps: consentSteps(row.path, craftar, settings.craftarHome, NO_TERMINAL) })
  } else {
    // One terminal per consent: a second click brings the same one forward instead of opening another.
    // terminal.create opens it in the background, so Orca's CLI brings it forward.
    const cli = findOrcaCli(process.env.PATH ?? '')
    const open = async (): Promise<string> => {
      const { terminalId } = (await s.orca.host.call('terminal.create', { workspaceId: row.id, title: 'craftar allow writes', command })) as { terminalId: string }
      return terminalId
    }
    let terminalId = consent.terminalId ?? (await open())
    let shown = cli ? await switchToTerminal(cli, terminalId) : false
    // Reopen only a terminal Orca no longer lists (the person closed it) — a switch that fails for another
    // reason must not open one more terminal per click.
    if (!shown && consent.terminalId && cli && (await terminalListed(cli, terminalId)) === false) {
      terminalId = await open()
      shown = await switchToTerminal(cli, terminalId)
    }
    const note = shown ? null : `A terminal titled "craftar allow writes" was opened in this workspace, in the background. Switch to it in Orca's terminal tabs and answer its question.`
    s.consent.set(row.path, { ...consent, terminalId, note })
  }
  await publish(s)
}

/**
 * The consent in words (O2): the person types it in a terminal; the plugin never types it. The binary, the
 * home and the directory are named as separate facts — never a command line to paste (§12a case 6).
 */
function consentSteps(ws: string, craftar: Craftar, home: string, why: string | null = null): string[] {
  return [
    ...(why ? [why] : []),
    'Open a terminal in this workspace.',
    `Run your craftar (${craftar.bin}) with its mcp allow-writes command, giving this workspace's folder as --workspace: ${ws}`,
    ...(home.trim() !== '' ? [`Set CRAFTAR_HOME to ${home.trim()} for it first, as the plugin's craftarHome setting does.`] : []),
    'Read what it will allow and answer its question yourself.',
    'Then click Update again.',
  ]
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
    version: null,
    sync: new Map(),
    consent: new Map(),
    lastSync: new Map(),
    fetchState: new Map(),
    send: new Map(),
    sendRefused: new Map(),
    registryDoc: null,
    reposDocs: new Map(),
    known: new Map(),
    marked: new Map(),
    forgeDirs: {},
    rowsById: new Map(),
    saveTimer: null,
    dismissed: new Set(),
    cleared: {},
    validating: false,
    forgePr: new Map(),
    discard: new Map(),
    discardHold: new Set(),
  }
  st = s
  orca.host
    .call('statusBar.update', { id: ITEM, text: 'craftar', tooltip: `craftar: reading${CLICK_HINT}`, icon: 'package' })
    .catch((e) => orca.log(failed('status bar', e)))
  firstBeat = tick()
  timer = setInterval(() => void tick(), HEARTBEAT_MS)
  if (typeof timer === 'object' && timer && 'unref' in timer) timer.unref()
  orca.commands.register('craftar.open', () =>
    orca.host.call('commands.run', { action: 'sidebar.right.toggle' }).catch((e) => orca.log(failed('open the side bar', e))),
  )
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
    // Check again asks craftar anew: a refusal to send is no longer shown as its answer, so Send is offered again.
    const focused = focusedPath(s)
    if (focused) s.sendRefused.delete(focused)
    await refresh(undefined, true)
    return view(s) as never
  })
  // A click on a file: it opens in an editor tab of Orca, in the focused workspace, at the path craftar lists.
  orca.panels.handle('file.open', async (input) => {
    const path = (input as { path?: unknown } | undefined)?.path
    const ws = focusedPath(s)
    const m = ws ? (s.models.get(ws) ?? null) : null
    // The worker is the gate, not the view: the path must be one craftar lists for the focused workspace, and on disk
    // (a `new` file the Forge brings is not there yet). The focus is read now: the file opens in the workspace in focus.
    const isNew = !!m && m.pending.some((f) => f.path === path && f.state === 'new')
    if (s.focus.kind !== 'one' || typeof path !== 'string' || !listed(m, path) || isNew) throw new Error('not a file this workspace lists: refresh the panel')
    try {
      await orca.host.call('editor.open', { workspaceId: s.focus.row.id, path })
    } catch (e) {
      orca.log(failed('open a file', e))
      throw new Error('Orca did not open the file: open it from the explorer')
    }
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
  orca.panels.handle('update.run', async (input) => {
    const files = (input as { files?: unknown } | undefined)?.files
    const u = updateView(s)
    const asked = u.files.map((f) => f.path).sort()
    const given = Array.isArray(files) ? files.filter((f): f is string => typeof f === 'string').sort() : null
    if (!u.allowed) throw new Error(u.reason ?? 'updating is not possible now')
    if (!given || given.length !== asked.length || given.some((p, i) => p !== asked[i])) throw new Error('the files changed since the panel showed them: look again and confirm')
    // Answered at once (plugin.request's ceiling is 120 s, measured): the update runs on, tracked, and the
    // panel follows it on state.changed.
    void track(s, runUpdate(s, u.files)).catch((e) => orca.log(failed('update', e)))
    return view(s) as never
  })
  // Both answer at once (plugin.request stops at 120 s; a promote proves against every registered
  // workspace) and run on, tracked; the panel follows on state.changed.
  orca.panels.handle('send.preview', async (input) => {
    const go = await sendPreview(s, (input as { path?: unknown } | undefined)?.path)
    void track(s, go()).catch((e) => orca.log(failed('send', e)))
    return view(s) as never
  })
  orca.panels.handle('send.run', async (input) => {
    const go = await sendRun(s, (input as { path?: unknown } | undefined)?.path)
    void track(s, go()).catch((e) => orca.log(failed('send', e)))
    return view(s) as never
  })
  // S3b: the PR in the Forge, after a Send wrote it. Each step its own click and its own visible terminal (O6).
  // One step starting at a time per workspace: a second click while a terminal opens starts nothing (consentBusy's precedent).
  const forgePrBusy = new Set<string>()
  const busyFor = async (ws: string, start: () => Promise<void>): Promise<never> => {
    forgePrBusy.add(ws)
    try {
      await start()
    } finally {
      forgePrBusy.delete(ws)
    }
    return view(s) as never
  }
  orca.panels.handle('forgepr.prepare', async () => {
    const ws = focusedPath(s)
    if (ws && forgePrBusy.has(ws)) throw new Error('a step of the Forge PR is already starting')
    const sd = ws ? s.send.get(ws) : undefined
    const m = ws ? s.models.get(ws) : undefined
    if (!ws || !sd || sd.phase !== 'done' || !sd.result) throw new Error('nothing was written to the Forge to open a PR for')
    const existing = s.forgePr.get(ws)
    if (existing && existing.phase !== 'opened') throw new Error('a Forge PR is already being prepared for this workspace: continue it first')
    const r = sd.result
    if (!isAbsolute(r.forge)) throw new Error('craftar did not name the Forge as an absolute path: open the PR from a terminal')
    const name = m?.name ?? ws
    // Busy from here: the origin is read before the first terminal opens, and a second click must start nothing.
    return busyFor(ws, async () => {
      const f: ForgePr = {
        open: true, phase: 'preparing', step: 'prepare', waiting: false,
        forge: r.forge, paths: r.written.map((w) => w.path), branch: defaultBranch(r.profile, r.ingredient),
        title: defaultTitle(r.promoted, name),
        body: prBody({ outcome: r.outcome, promoted: r.promoted, written: r.written, others: r.impact.workspaces.length, workspaceName: name }),
        identity: null, forgeBranch: null, authorDiffers: null, url: null, attached: null, steps: [], note: null,
        host: await originHost(r.forge),
      }
      s.forgePr.set(ws, f)
      s.send.delete(ws)
      await runForgePrStep(s, ws, 'prepare')
    })
  })
  orca.panels.handle('forgepr.step', async (input) => {
    const ws = focusedPath(s)
    const f = ws ? s.forgePr.get(ws) : undefined
    const i = (input ?? {}) as { step?: unknown; branch?: unknown; title?: unknown }
    if (!ws || !f) throw new Error('no Forge PR is being prepared here')
    if (forgePrBusy.has(ws)) throw new Error('a step of the Forge PR is already starting')
    const step = i.step
    const after: Record<string, ForgePr['phase']> = { commit: 'ready', push: 'committed', pr: 'pushed' }
    if (step !== 'prepare' && step !== 'commit' && step !== 'push' && step !== 'pr') throw new Error('not a step of the Forge PR')
    if (step === 'prepare' && !(f.phase === 'failed' && f.step === 'prepare')) throw new Error('the preview is read once')
    // A failed step can be tried again; otherwise only the next step, in order.
    const retry = f.phase === 'failed' && f.step === step
    if (!retry && step !== 'prepare' && f.phase !== after[step]) throw new Error('that step waits for the one before it')
    let next = f
    if (step === 'commit') {
      const branch = typeof i.branch === 'string' ? i.branch.trim() : f.branch
      const title = typeof i.title === 'string' ? i.title.trim() : f.title
      const fault = branchFault(branch) ?? titleFault(title)
      if (fault) throw new Error(fault)
      next = { ...f, branch, title }
    }
    s.forgePr.set(ws, next)
    return busyFor(ws, () => runForgePrStep(s, ws, step))
  })
  // After the wait, the person reads the terminal again: the same step is followed once more.
  orca.panels.handle('forgepr.check', async () => {
    const ws = focusedPath(s)
    const f = ws ? s.forgePr.get(ws) : undefined
    if (!ws || !f || !f.waiting || !f.step || !f.nonce || !f.terminalId) throw new Error('no step is waiting')
    s.forgePr.set(ws, { ...f, waiting: false, note: null })
    void track(s, followForgePrStep(s, ws, f.step, f.nonce, f.terminalId))
    return view(s) as never
  })
  orca.panels.handle('forgepr.show', async (input) => {
    const ws = focusedPath(s)
    const f = ws ? s.forgePr.get(ws) : undefined
    if (!ws || !f) throw new Error('no Forge PR is being prepared here')
    if (forgePrBusy.has(ws)) throw new Error('a step of the Forge PR is starting: wait for its terminal')
    const open = (input as { open?: unknown } | null)?.open === true
    // Back from a PR that is open on the Forge: nothing is left to do here.
    if (!open && f.phase === 'opened') s.forgePr.delete(ws)
    else s.forgePr.set(ws, { ...f, open })
    await publish(s)
    return view(s) as never
  })
  // Drop the steps that are left: what is already done in the Forge (a branch, a commit) stays as it is.
  orca.panels.handle('forgepr.drop', async () => {
    const ws = focusedPath(s)
    if (ws && forgePrBusy.has(ws)) throw new Error('a step of the Forge PR is starting: wait for its terminal')
    if (ws) s.forgePr.delete(ws)
    await publish(s)
    return view(s) as never
  })
  // Discard (spec 60 §8a): the confirmation (first click), then the run (second click), one at a time per workspace.
  const discardBusy = new Set<string>()
  const discardFor = async (ws: string, work: () => Promise<void>): Promise<never> => {
    discardBusy.add(ws)
    try {
      await work()
    } finally {
      discardBusy.delete(ws)
    }
    await publish(s)
    return view(s) as never
  }
  /** The confirmation for a path: offline reads, nothing pending, the diff (or craftar's note), the row's Forge side. */
  const confirmDiscard = async (ws: string, path: string, message: string | null): Promise<void> => {
    const craftar = s.craftar
    if (!craftar) throw new Error('craftar is not ready (see the self-check)')
    const settings = await readSettings(orca)
    const [st, dr] = await s.queue.run(ws, async () => [await readStatusDoc(craftar, ws, { fetch: false }), await driftShow(craftar, ws)] as const)
    const row = dr.files.find((f) => f.path === path)
    const fault = rowFault(row)
    if (fault || !row) throw new Error(fault ?? 'not a file craftar lists as edited here')
    const pending = pendingOf(st)
    if (pending.length > 0) throw new Error(`Update first: ${pending.length === 1 ? '1 file is' : `${pending.length} files are`} coming from the Forge. Bring them with Update and stage, then discard.`)
    if (st.forge?.kind && st.forge.kind !== 'path' && !settings.fetch) throw new Error('Discard needs a fetched Forge: turn "Fetch a remote Forge" on in the plugin settings')
    const d = await s.queue.run(ws, () => {
      if (!s.craftar) throw new Error('no craftar')
      if (!s.diff || s.diff.ws !== ws) s.diff = { ws, child: new DiffChild(s.craftar, ws) }
      return s.diff.child.diff(path)
    }).catch((e) => ({ files: [], refused: e instanceof DiffRefused ? e.message : 'craftar mcp did not answer' }) as unknown as { files: { path: string; diff: string | null; note: string | null }[]; refused?: string })
    const file = d.files.find((f) => f.path === path)
    const diff = file?.diff ?? null
    const note = file?.note ?? ((d as { refused?: string }).refused ?? null)
    // No diff can show the Forge's new text of a file craftar withholds: not offered when the Forge changed it too.
    if (diff === null && row.forge === 'changed') throw new Error("craftar does not show this file's content, and the Forge changed it too: no diff can show what a discard would write. Discard it by hand if you mean to.")
    s.discard.set(ws, { path, phase: 'confirm', deleted: row.state === 'orphan-drift', diff, note, message, after: null, before: st, rowForge: row.forge })
  }
  orca.panels.handle('discard.open', async (input) => {
    const ws = focusedPath(s)
    const path = (input as { path?: unknown } | null)?.path
    if (!ws || typeof path !== 'string') throw new Error('not a file this workspace lists: refresh the panel')
    if (discardBusy.has(ws)) throw new Error('a discard is already running in this workspace')
    return discardFor(ws, () => confirmDiscard(ws, path, null))
  })
  orca.panels.handle('discard.run', async (input) => {
    const ws = focusedPath(s)
    const path = (input as { path?: unknown } | null)?.path
    const d = ws ? s.discard.get(ws) : undefined
    if (!ws || !d || d.phase !== 'confirm' || d.path !== path || !d.before) throw new Error('look at the confirmation first')
    if (discardBusy.has(ws)) throw new Error('a discard is already running in this workspace')
    const craftar = s.craftar
    if (!craftar) throw new Error('craftar is not ready (see the self-check)')
    // Answered at once (a panel request stops at 120 s, and a fetch then the discard can take longer): the run goes on, tracked,
    // and the panel follows it on state.changed. Busy from now, so a second click starts nothing.
    discardBusy.add(ws)
    s.discard.set(ws, { ...d, phase: 'checking', message: null })
    void track(s, discardFor(ws, async () => {
      const src = d.before?.forge?.source ?? null
      if (src) s.discardHold.add(src)
      s.discard.set(ws, { ...d, phase: 'checking', message: null })
      await publish(s)
      let redraw = false
      try {
        await s.queue.run(ws, async () => {
          // The second read fetches the Forge the discard will write from.
          const st = await readStatusDoc(craftar, ws, { fetch: true })
          const failedFetch = fetchFailed(st)
          if (failedFetch) {
            s.discard.set(ws, { ...d, phase: 'error', message: `Nothing was written: the Forge could not be fetched.\n${failedFetch.join('\n')}` })
            return
          }
          const pending = pendingOf(st)
          if (pending.length > 0) {
            s.discard.set(ws, { ...d, phase: 'error', message: `Nothing was written: ${pending.length === 1 ? '1 file is' : `${pending.length} files are`} now coming from the Forge. Update first.` })
            return
          }
          const dr = await driftShow(craftar, ws)
          const row = dr.files.find((f) => f.path === d.path)
          // A path Forge's commit is its HEAD, which an edit to its working tree does not move: the diff is asked again and compared
          // (spec 60 §8a item 2). A row with no diff text is guarded by the drift row's Forge side instead.
          let diffMoved = false
          if (d.diff !== null) {
            if (!s.diff || s.diff.ws !== ws) s.diff = { ws, child: new DiffChild(craftar, ws) }
            const again = await s.diff.child.diff(d.path).catch(() => null)
            diffMoved = (again?.files.find((f) => f.path === d.path)?.diff ?? null) !== d.diff
          }
          if (diffMoved || (st.forge?.commit ?? null) !== (d.before?.forge?.commit ?? null) || !row || row.forge !== d.rowForge || rowFault(row)) {
            // The text that would be written changed: the confirmation is drawn again, on the new diff (after this queue turn).
            redraw = true
            return
          }
          s.discard.set(ws, { ...d, phase: 'running' })
          await publish(s)
          const r = await run(craftar.bin, discardArgs(d.path, ws), craftar.env, 120_000)
          if (r.code !== 0) {
            const words = [r.stderr.trim(), r.stdout.trim()].filter((x) => x !== '').join('\n')
            s.discard.set(ws, { ...d, phase: 'error', message: words || (r.code === null ? 'craftar drift discard did not finish in time' : `craftar drift discard exited ${r.code}`) })
            return
          }
          const after = await readStatusDoc(craftar, ws, { fetch: false })
          const cmp = afterDiscard(d.before!, after, d.path)
          s.discard.set(ws, { ...d, phase: 'done', after: { ...cmp, warnings: after.warnings } })
        })
      } catch (e) {
        s.orca.log(failed('discard', e))
        s.discard.set(ws, { ...d, phase: 'error', message: 'the discard stopped on an unexpected error: see the plugin log' })
      } finally {
        if (src) s.discardHold.delete(src)
      }
      if (redraw) {
        s.discard.delete(ws)
        await confirmDiscard(ws, d.path, 'The Forge moved since the confirmation: look at the diff again before you discard.').catch((e) => {
          s.discard.set(ws, { ...d, phase: 'error', message: e instanceof Error ? e.message : 'the confirmation could not be read again' })
        })
        return
      }
      const row = [...s.rowsById.values()].find((r) => r.path === ws)
      if (row) await readWorkspace(s, row, 'focus', await readSettings(orca))
    }).catch((e) => s.orca.log(failed('discard', e))))
    await publish(s)
    return view(s) as never
  })
  orca.panels.handle('discard.cancel', async () => {
    const ws = focusedPath(s)
    const d = ws ? s.discard.get(ws) : undefined
    if (ws && d && (d.phase === 'checking' || d.phase === 'running')) throw new Error('the discard is running: wait for it')
    if (ws) s.discard.delete(ws)
    await publish(s)
    return view(s) as never
  })
  orca.panels.handle('send.cancel', async () => {
    const ws = focusedPath(s)
    if (ws) refuseWhileBusy(s, ws)
    if (ws) s.send.delete(ws)
    return view(s) as never
  })
  orca.panels.handle('forge.dir.set', async (input) => {
    const dir = (input as { dir?: unknown } | undefined)?.dir
    const ws = focusedPath(s)
    if (!ws) throw new Error('no craftar workspace has the focus')
    if (!forgeIsRemote(s, ws)) throw new Error('this Forge is on this machine: craftar finds it by itself, no clone to name')
    refuseWhileBusy(s, ws)
    // An empty folder forgets the stored one: the panel asks for it again ("Change").
    if (dir === '') {
      const rest = { ...s.forgeDirs }
      delete rest[ws]
      await orca.storage.set(FORGE_DIRS, rest)
      delete s.forgeDirs[ws]
      s.send.delete(ws)
      return view(s) as never
    }
    if (typeof dir !== 'string' || !isAbsolute(dir) || /[\u0000-\u001f\u007f]/.test(dir)) throw new Error('give the absolute path of a folder that holds a clone of the Forge')
    // Stored first: a folder storage refused is not used either.
    await orca.storage.set(FORGE_DIRS, { ...s.forgeDirs, [ws]: dir })
    s.forgeDirs[ws] = dir
    // A plan made against another folder is not this one's.
    s.send.delete(ws)
    return view(s) as never
  })
  // O7: an early hint on save — never refuses, never awaits, reads only the event's path; the text is not
  // touched, kept, logged or sent. It marks a file craftar lists and asks for a read soon; drift show decides.
  orca.hooks.on('editor.save.before', (event) => {
    const e = event as { workspaceId?: unknown; path?: unknown }
    const byId = typeof e.workspaceId === 'string' ? s.rowsById.get(e.workspaceId) : undefined
    // The editor's workspace id is not measured to equal workspace.list's: an id the list does not hold falls back
    // to the focused workspace. A wrong guess costs one read of it — drift show decides, the hook only hints.
    const focused = s.focus.kind === 'one' ? s.focus.row : undefined
    const row = byId ?? focused
    // Orca gives a path relative to the workspace root (absolute outside one); an absolute one under the root
    // is turned relative too, backslashes read as slashes — craftar's paths are relative POSIX.
    const rel = row && typeof e.path === 'string' ? relativeTo(row.path, e.path) : null
    const isFocused = !!row && row.path === focusedPath(s)
    const recorded = !!row && rel !== null && s.known.get(row.path)?.has(rel) === true
    // Yes/no only — never the path or the text: what the live run needs to see why a save was or was not marked.
    orca.log(`save hook: workspace ${byId ? 'listed' : focused ? 'not listed, focused used' : 'not listed'}, inside it ${rel !== null ? 'yes' : 'no'}, focused ${isFocused ? 'yes' : 'no'}, recorded in the lock ${recorded ? 'yes' : 'no'}`)
    // Only the focused workspace is read on a focus refresh: a file of another one is left to its next read.
    if (row && rel !== null && isFocused && recorded) {
      const set = s.marked.get(row.path) ?? new Set<string>()
      set.add(rel)
      s.marked.set(row.path, set)
      // A new save is a new edit: craftar may answer otherwise, so its refusal of this file is asked again.
      s.sendRefused.get(row.path)?.delete(rel)
      scheduleRead(s, () => refresh())
    }
    return undefined
  })
  orca.panels.handle('consent.terminal', async () => {
    await openConsentTerminal(s)
    return view(s) as never
  })
  orca.panels.handle('diff.get', async (input) => {
    const path = (input as { path?: unknown } | undefined)?.path
    const ws = focusedPath(s)
    const m = ws ? (s.models.get(ws) ?? null) : null
    if (!ws || !s.craftar || typeof path !== 'string' || !listed(m, path)) {
      return { refused: 'not a file this workspace lists: refresh the panel' } as never
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
  // A card closed with ×: hidden until craftar says something else (the key holds craftar's words) or the worker restarts.
  orca.panels.handle('card.dismiss', async (input) => {
    const key = (input as { key?: unknown } | undefined)?.key
    if (typeof key !== 'string' || key === '' || key.length > 8192) throw new Error('not a card the panel shows')
    s.dismissed.delete(key)
    s.dismissed.add(key)
    while (s.dismissed.size > DISMISSED_MAX) s.dismissed.delete(s.dismissed.values().next().value as string)
    await publish(s)
    return view(s) as never
  })
  // Clear: the bell's messages for the focused workspace are hidden until they change; only their digest is stored.
  orca.panels.handle('messages.clear', async () => {
    const ws = focusedPath(s)
    const words = ws ? craftarWords(s, ws) : []
    if (!ws || words.length === 0) throw new Error('craftar has no message to clear here')
    s.cleared = { ...s.cleared, [ws]: messagesDigest(ws, words) }
    await orca.storage.set(CLEARED, s.cleared).catch((e) => orca.log(failed('storage', e)))
    await publish(s)
    return view(s) as never
  })
  // Validate: the self-check run again and the probe, on demand; the report is shown in the panel, kept in memory only.
  orca.panels.handle('validate.run', async () => {
    if (!s.validating) {
      s.validating = true
      await publish(s)
      void track(s, (async () => {
        try {
          const settings = await readSettings(orca)
          const { local } = await listRows(orca)
          await s.queue.run(FOCUS_QUEUE, () => ensureCheck(s, settings, local, true))
          if (!probing) probing = probe(orca, startedAt, { notify: false }).finally(() => (probing = null))
          await probing
        } catch (e) {
          orca.log(failed('validate', e))
        } finally {
          s.validating = false
          await publish(s).catch((e) => orca.log(failed('validate publish', e)))
        }
      })())
    }
    return view(s) as never
  })
  void orca.storage
    .get(CLEARED)
    .then((v) => {
      if (v && typeof v === 'object') for (const [k, d] of Object.entries(v as Record<string, unknown>)) if (typeof d === 'string' && /^[0-9a-f]{64}$/.test(d)) s.cleared[k] = d
    })
    .catch(() => undefined)
  void orca.storage
    .get(FORGE_DIRS)
    .then((v) => {
      if (v && typeof v === 'object') for (const [k, d] of Object.entries(v as Record<string, unknown>)) if (typeof d === 'string') s.forgeDirs[k] = d
    })
    .catch(() => undefined)
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
  if (s?.saveTimer) clearTimeout(s.saveTimer)
  if (s?.diff) void s.diff.child.stop()
}
