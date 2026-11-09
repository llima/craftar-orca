// The panel's drawing (spec 60 §6), as a function of the worker's view, in the layout the user approved on
// 2026-11-08 (the mockup of the nine layout items): a header with the messages bell and Check again; the sync
// diagram as the site draws it — the Forge, craftar sync, one card per surface (craftar's owners) and the
// workspace with its profile below; the files in both directions; the actions in a fixed footer toolbar. Send
// and Bring each take the body over with their own screen and their own toolbar. Every value is put in with
// textContent, never as markup.
import type { Line } from './self-check'
import type { UnsetParam } from './craftar'
import type { PanelModel } from './model'
import type { View } from './worker'
import { EXAMPLE_SETTINGS } from './discard'
import { cachedAgeLine, classify, counted as needsLook, type Message } from './messages'

// craftar's question in `craftar mcp allow-writes` (craftar-cli src/core/write-actions.ts, confirmWrites), quoted verbatim.
export const CONSENT_QUESTION = 'Let craftar mcp --allow-writes write here [no]: '

const SVG = 'http://www.w3.org/2000/svg'

/** S2's additions to the view (agent 58's contract, 2026-11-07): optional here until the worker sends them. */
export interface S2View {
  update?: { allowed: boolean; reason: string | null; files: { path: string; state: string }[] }
  sync?: { phase: 'idle' | 'running' | 'consent' | 'done' | 'error'; message: string | null }
  consent?: { text: string; terminal: 'offered' | 'words'; steps: string[]; note?: string | null; answer?: 'recorded' | 'cancelled' | null } | null
  lastSync?: {
    written: string[]
    removed: { path: string; reason: string }[]
    kept: { path: string; state: string; reason: string | null }[]
    staged: string[]
    leftOut?: string[]
    differences: string[]
    warnings: string[]
    rerun: boolean
  } | null
}

// The panel reads S2's fields as optional (a panel can meet an older worker), so they are taken out of the
// worker's View rather than intersected with it: the two shapes never contradict each other.
export type PanelView = Omit<View, 'update' | 'sync' | 'consent' | 'lastSync' | 'send' | 'sendAll' | 'forgeDir' | 'marked' | 'sendRefused' | 'dismissed' | 'messagesCleared' | 'validating' | 'forgePr' | 'discard' | 'discardOff'> & S2View & S3View & BellView & PrView & DiscardView

/** Discard's addition (spec 60 §8a): optional, as the others. */
export interface DiscardView {
  discard?: View['discard']
  discardOff?: string | null
}

/** S3b's addition: the PR in the Forge (optional, as the others). */
export interface PrView {
  forgePr?: View['forgePr']
}

/** The bell's additions (the user's request of 2026-11-08): optional, as S2's and S3a's. */
export interface BellView {
  /** The keys of the cards closed with ×, kept by the worker in memory only. */
  dismissed?: string[]
  /** The bell's messages were cleared and nothing changed since. */
  messagesCleared?: boolean
  /** Validate is running. */
  validating?: boolean
}

export interface Actions {
  choose(id: string): void
  refresh(): void
  showDiff(path: string): void
  /** `file.open`: the file in an editor tab of Orca (`editor.open`). */
  openFile?(path: string): void
  /** Change opened the Forge clone box with this draft, or Cancel closed it (null); the panel keeps it across redraws. */
  forgeDirEdit?(draft: string | null): void
  /** What the person typed in that box, kept without a redraw. */
  forgeDirDraft?(value: string): void
  /** Discard (spec 60 §8a): open the confirmation, run it (the second click), leave it. */
  discardOpen?(path: string): void
  discardRun?(path: string): void
  discardCancel?(): void
  /** S3b: prepare the PR after a Send, run a step, read a waiting terminal again, show or leave the PR screen, drop the steps left. */
  forgePrPrepare?(): void
  forgePrStep?(step: 'prepare' | 'commit' | 'push' | 'pr', branch?: string, title?: string): void
  forgePrCheck?(): void
  forgePrShow?(open: boolean): void
  forgePrDrop?(): void
  /** What the person typed in the branch or title fields, kept across redraws by panel.ts. */
  forgePrDraft?(field: 'branch' | 'title', value: string): void
  /** The diff shown in the panel closed (its ×, its row's button again, or Esc). */
  closeDiff?(): void
  /** S2: `update.run` with the paths the confirm listed. */
  updateRun?(files: string[]): void
  /** S2: `consent.terminal`. */
  consentTerminal?(): void
  /** S3a: `send.preview` (the dry run), `send.run` (the write, second click), `send.cancel`, `forge.dir.set`. */
  sendPreview?(path: string): void
  sendRun?(path: string): void
  /** The newer-tag line's Open craftar.yaml (`config.open`): a read, the person edits the ref. */
  configOpen?(): void
  /** Send all: `sendall.preview`, `sendall.run` (the planned paths, second click), `sendall.cancel`, `sendall.rest`, `forgepr.more`. */
  sendAllPreview?(): void
  sendAllRun?(paths: string[]): void
  sendAllCancel?(): void
  sendAllRest?(): void
  forgePrMore?(): void
  sendCancel?(): void
  forgeDirSet?(dir: string): void
  /** The bell: `card.dismiss` (a card closed with ×), `messages.clear`, `validate.run`; the panel's own notice closed. */
  dismiss?(key: string): void
  messagesClear?(): void
  validate?(): void
  clearNotice?(): void
  /** The fetch-failed card's Try again: the periodic check, run now (the one read that fetches). */
  checkNow?(): void
  /**
   * The bell's open or closed state as the person last left it, for the message set it was left on, kept by the panel
   * across redraws (memory only): a redraw never reopens a bell the person closed, and a new message set may.
   */
  bellState?(): { key: string; open: boolean } | null
  bellSet?(key: string, open: boolean): void
}

/** S3a's additions to the view (spec 60 §8, O5, O7): optional, as S2's. */
export interface S3View {
  send?: {
    path: string
    phase: 'checking' | 'preview' | 'writing' | 'done' | 'error'
    plan: PromotePlan | null
    result: PromotePlan | null
    message: string | null
  } | null
  forgeDir?: { needed: boolean; dir: string | null }
  marked?: string[]
  /** The files craftar refused to send, in its words: kept here, no Send, until the file is saved again. */
  sendRefused?: { path: string; message: string }[]
  /** Send all (the user's design A of 2026-11-08): one plan for every file, the writes in order, a stop at a refusal. */
  sendAll?: {
    phase: 'checking' | 'plan' | 'writing' | 'stopped' | 'done' | 'error'
    items: { path: string; plan: PromotePlan | null; result: PromotePlan | null; refused: string | null }[]
    current: string | null
    stopped: { path: string; message: string; craftar: boolean } | null
    remaining: string[]
    message: string | null
    more: boolean
  } | null
}

export interface PromotePlan {
  dryRun: boolean
  path: string
  ingredient: string
  outcome: string
  promoted: string
  written: { path: string; action: string }[]
  params: { key: string; old: unknown; value: unknown }[]
  sections: { key: string; name: string }[]
  impact: { registry: string; workspaces: unknown[] }
  warnings: string[]
  flattened?: { params?: unknown; sections?: unknown }
  dependents?: unknown[]
  nextSync?: { counts: Record<string, number> }
}

export type DiffShown = { path: string; text: string; warnings?: string[] } | { path: string; refused: string } | null

type Doc = Pick<Document, 'createElement' | 'createElementNS'>
type Kid = Node | string | null | undefined | false

// craftar's own words for a refused sync (craftar-cli src/core/sync.ts: unsetSummary, unsetRefusal).
export function refusalLines(unset: UnsetParam[]): string[] {
  return [
    `sync refused: declared parameter(s) with no value: ${unset.map((u) => u.key).join(', ')}`,
    ...unset.map((u) => `  ${u.key}  declared by ${u.declaredBy.join(', ')} · cited by ${u.citedBy.join(', ')}`),
    '  fix: set each under params in the profile, or under overrides.params in craftar.yaml',
  ]
}

const ICON: Record<string, string> = {
  refresh: 'M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5v3h-3',
  bell: 'M4 11.5V7.5a4 4 0 0 1 8 0v4l1.2 1.3H2.8zM6.5 14h3',
  shield: 'M8 1.8 13 3.6v4.1c0 3-2.1 5.4-5 6.5-2.9-1.1-5-3.5-5-6.5V3.6zM5.8 8l1.6 1.6L10.4 6.5',
  close: 'M4 4l8 8M12 4l-8 8',
  down: 'M8 2.5v9M4 8l4 4 4-4M3 14h10',
  up: 'M8 13.5v-9M4 8l4-4 4 4M3 2h10',
  check: 'M5 8.2l2 2 4-4.2',
  diff: 'M5 2.5v7M1.5 6h7M7.5 13.5h7M11 2.5l-3 11',
  term: 'M2.5 4.5 6 8l-3.5 3.5M8 12h5.5',
  ws: 'M2.5 3.5h11v9h-11zM2.5 6h11',
}

// The list icon per craftar state: new, update (and adopt), removed, edited by hand, kept apart.
const STATE_ICON: Record<string, [string, string]> = {
  new: ['new', '+'],
  update: ['upd', '~'],
  adopt: ['upd', '~'],
  orphan: ['del', '−'],
  drift: ['edit', '✎'],
  collision: ['apart', '!'],
  'orphan-drift': ['apart', '!'],
}

const NOT_BUILT_UPDATE = 'Update and stage is not built yet in this version of the plugin. Until then, run craftar sync in a terminal.'
const NOT_BUILT_SEND = 'Send to Forge is not built yet in this version of the plugin.'
const NEEDS_CLONE = 'name a local clone of the Forge first'

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`
const short = (c: string | null): string | null => (c ? c.slice(0, 7) : null)

/** `notice`: the worker's refusal of the panel's last request, drawn as text whatever the focus (nothing is dropped). */
/** `forgeEdit`: the Forge clone box the person opened with Change, and what they typed in it, kept by panel.ts across redraws; null when closed. */
export function render(doc: Doc, root: HTMLElement, v: PanelView, a: Actions, diff: DiffShown = null, notice: string | null = null, forgeEdit: string | null = null, prDraft: { branch?: string; title?: string } | null = null): void {
  const h = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...kids: Kid[]): HTMLElementTagNameMap[K] => {
    const e = doc.createElement(tag)
    for (const [k, val] of Object.entries(attrs)) e.setAttribute(k, val)
    for (const k of kids) {
      if (k === null || k === undefined || k === false) continue
      if (typeof k === 'string') {
        const t = doc.createElement('span')
        t.textContent = k
        e.appendChild(t)
      } else e.appendChild(k)
    }
    return e
  }
  // An element holding one text value.
  const t = <K extends keyof HTMLElementTagNameMap>(tag: K, text: string, attrs: Record<string, string> = {}): HTMLElementTagNameMap[K] => {
    const e = h(tag, attrs)
    e.textContent = text
    return e
  }
  const s = (tag: string, attrs: Record<string, string> = {}): SVGElement => {
    const e = doc.createElementNS(SVG, tag) as SVGElement
    for (const [k, val] of Object.entries(attrs)) e.setAttribute(k, val)
    return e
  }
  const icon = (name: string): SVGElement => {
    const svg = s('svg', { viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.6', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false' })
    svg.appendChild(s('path', { d: ICON[name] }))
    return svg
  }
  const button = (label: string, attrs: Record<string, string>, ic: string | null, onClick: (() => void) | null): HTMLButtonElement => {
    const b = h('button', { type: 'button', ...attrs })
    if (ic) b.appendChild(icon(ic))
    b.appendChild(t('span', label))
    if (onClick) b.addEventListener('click', onClick)
    return b
  }
  const heading = (title: string, n: number | null): HTMLElement => {
    const head = h('h3')
    head.appendChild(t('span', title))
    if (n !== null) head.appendChild(t('span', String(n), { class: 'n' }))
    return head
  }
  const sec = (title: string, n: number | null, body: Node, attrs: Record<string, string> = {}): HTMLElement => {
    const box = h('section', { class: 'sec', ...attrs })
    box.appendChild(heading(title, n))
    box.appendChild(body)
    return box
  }
  // × on a card: it hides that card, with these words, until craftar says something else; nothing it refused changes.
  const closer = (label: string, onClick: () => void): HTMLButtonElement => {
    const b = h('button', { class: 'x-btn', type: 'button', title: label, 'aria-label': label, 'data-action': 'dismiss' })
    b.appendChild(icon('close'))
    b.addEventListener('click', onClick)
    return b
  }
  const cardHead = (title: string, key: string): HTMLElement =>
    h('div', { class: 'card-h' }, t('h2', title), typeof a.dismiss === 'function' ? closer(`Close: ${title}`, () => a.dismiss?.(key)) : null)
  root.replaceChildren()
  root.setAttribute('class', 'shell')

  // A file craftar refused to send stays here in craftar's words, with no Send, until it is saved again.
  const refusedSend = new Map((v.sendRefused ?? []).map((r) => [r.path, r.message]))
  const shown = v.focus === 'one' ? v.model : null
  const m = shown && refusedSend.size > 0
    ? { ...shown, edited: shown.edited.map((e) => (e.promotable && refusedSend.has(e.path) ? { ...e, promotable: false, reason: 'kept here: craftar will not send it' } : e)) }
    : shown
  const failing = v.selfCheck.filter((l) => l.level !== 'ok')
  // P1: the lines that mean craftar has to be installed or upgraded have a card of their own, first and not closable.
  const install = failing.filter((l) => l.install !== undefined)
  const broken = !v.model && failing.some((l) => l.level === 'error')
  const promotable = m ? m.edited.filter((e) => e.promotable).length : 0
  const cached = m?.forge?.freshness === 'cached'
  const version = v.selfCheck.map((l) => /^version (\S+)$/.exec(l.message)?.[1]).find((x) => x !== undefined) ?? null
  const dismissed = new Set(v.dismissed ?? [])
  // A card's key: the card, the workspace, and craftar's words — a different message is a different card.
  const cardKey = (role: string, ...words: string[]): string => [role, m?.ws ?? '', ...words].join('\u0000')
  const owners = m ? m.outputs.map((o) => o.owner) : []
  // The bell: craftar's warnings and errors, its refusals to send (so a closed card's words stay reachable), and the
  // plugin's own line for a cached copy's age. Each keeps craftar's words; a fix is a line of its own.
  const messages: Message[] = m
    ? [
        ...(cached ? [cachedAgeLine(m.forge?.fetchedAt ?? null, Date.now())] : []),
        ...(m.refused ? [classify(refusalLines(m.unset).join('\n'), true, owners)] : []),
        ...m.errors.map((e) => classify(e, true, owners)),
        ...(v.sendRefused ?? []).map((r) => classify(`${r.path}: ${r.message}`, true, owners)),
        ...(v.sync?.phase === 'error' && v.sync.message ? [classify(v.sync.message, true, owners)] : []),
        ...m.warnings.map((w) => classify(w, false, owners)),
      ]
    : []
  // The self-check's failures are craftar's (or the plugin's) words too: a closed Self-check card leaves them here.
  for (const l of failing) messages.unshift(l.level === 'error' ? { text: l.message, level: 'error', from: 'craftar' } : { text: l.message, level: 'action', from: 'craftar' })
  const cleared = v.messagesCleared === true
  const badge = cleared ? 0 : needsLook(messages)
  const hasError = !cleared && messages.some((x) => x.level === 'error')

  // ---- header: the logo, the workspace, the bell, Check again ----
  const header = root.appendChild(h('header'))
  // The logo's three squares on its dark tile (assets/icon.svg, variant A2), drawn inline: Orca takes only
  // named icons for the panel tab and the status bar item. Decorative: the title says "craftar".
  const logo = header.appendChild(s('svg', { viewBox: '0 0 64 64', class: 'logo', 'data-role': 'logo', 'aria-hidden': 'true', focusable: 'false' }))
  logo.appendChild(s('rect', { width: '64', height: '64', rx: '10', fill: '#0A0E13' }))
  logo.appendChild(s('rect', { x: '20.696', y: '7.124', width: '22.62', height: '22.62', rx: '3.393', fill: '#E7ECF1' }))
  logo.appendChild(s('rect', { x: '7.124', y: '34.268', width: '22.62', height: '22.62', rx: '3.393', fill: '#E9915A' }))
  logo.appendChild(s('rect', { x: '34.268', y: '34.268', width: '22.62', height: '22.62', rx: '3.393', fill: '#7FB4D6' }))
  const h1 = header.appendChild(h('h1', { class: 'title' }))
  h1.appendChild(t('span', 'craftar', { class: 'brand' }))
  if (m) h1.appendChild(t('span', m.name, { class: 'ws-name' }))
  header.appendChild(h('span', { class: 'spacer' }))
  // Item 8: craftar's warnings and errors behind a bell; opened at once when craftar reports an error. A cached copy
  // does not open it: its card says so and holds Try again, which an open bell would cover. Once the person opened or
  // closed it, a redraw keeps that for the same messages (Try again redrew it open, the user's report of 2026-11-08).
  const bellKey = (m?.ws ?? '') + '\u0002' + messages.map((x) => `${x.level}\u0000${x.text}`).join('\u0001')
  const left = a.bellState?.() ?? null
  const openAtStart = left && left.key === bellKey ? left.open : !!m && !cleared && (m.errors.length > 0 || m.refused || m.checkFailed)
  const bell = header.appendChild(
    h('button', {
      class: `icon-btn bell${openAtStart ? ' on' : ''}${hasError ? ' bad' : ''}`,
      type: 'button',
      title: messages.length === 0 ? 'No message from craftar' : cleared ? 'craftar says nothing new since you cleared it' : `craftar says: ${plural(messages.length, 'message', 'messages')}`,
      'aria-label': badge > 0 ? `Messages from craftar, ${badge} to look at` : messages.length > 0 ? `Messages from craftar, ${messages.length}, nothing to look at` : 'Messages from craftar, none',
      'aria-expanded': openAtStart ? 'true' : 'false',
      'data-action': 'messages',
      'aria-controls': 'craftar-messages',
    }),
  )
  bell.appendChild(icon('bell'))
  if (badge > 0) bell.appendChild(t('span', String(badge), { class: 'badge', 'data-role': 'messages-count' }))
  // Validate, beside the bell: the self-check and the probe run again on demand, their report shown in the body.
  const validating = v.validating === true
  const validate = header.appendChild(
    h('button', {
      class: 'icon-btn',
      type: 'button',
      title: validating ? 'Validating…' : 'Validate: run the self-check and the probe again',
      'aria-label': validating ? 'Validating' : 'Validate: run the self-check and the probe again',
      'data-action': 'validate',
      ...(validating || typeof a.validate !== 'function' ? { disabled: '', 'aria-busy': validating ? 'true' : 'false' } : {}),
    }),
  )
  validate.appendChild(icon('shield'))
  validate.addEventListener('click', () => a.validate?.())
  const refresh = header.appendChild(h('button', { class: 'icon-btn', type: 'button', title: 'Check again', 'aria-label': 'Check again', 'data-action': 'refresh' }))
  refresh.appendChild(icon('refresh'))
  refresh.addEventListener('click', () => a.refresh())

  const pop = root.appendChild(h('div', { id: 'craftar-messages', class: openAtStart ? 'pop open' : 'pop', role: 'region', 'aria-label': 'Messages from craftar', 'data-role': 'messages' }))
  const popHead = pop.appendChild(h('div', { class: 'pop-h' }, t('span', 'craftar says'), t('span', String(messages.length), { class: 'n' })))
  // Clear hides craftar's words; the plugin's own line (a cached copy's age) is not something to clear.
  if (messages.some((x) => x.from === 'craftar') && !cleared && typeof a.messagesClear === 'function') {
    popHead.appendChild(button('Clear', { class: 'btn ghost clear', 'data-action': 'messages-clear', title: 'Hide these messages until craftar says something different' }, null, () => a.messagesClear?.()))
  }
  if (messages.length === 0) pop.appendChild(t('p', 'No message from craftar.', { class: 'muted' }))
  else {
    if (cleared) pop.appendChild(t('p', 'Cleared. They come back when craftar says something different.', { class: 'muted', 'data-role': 'messages-cleared' }))
    const ul = pop.appendChild(h('ul', { class: cleared ? 'msgs cleared' : 'msgs' }))
    for (const x of messages) {
      const li = ul.appendChild(h('li', { class: x.level === 'error' ? 'err error' : x.level === 'info' ? 'info' : 'act', 'data-level': x.level, 'data-from': x.from }))
      li.appendChild(t('span', x.level === 'error' ? 'error' : x.level === 'info' ? 'info' : 'to look at', { class: 'lvl' }))
      li.appendChild(t('span', x.text, { class: 'say', 'data-role': x.level === 'error' ? 'error' : x.from === 'plugin' ? 'plugin-line' : 'warning' }))
      if (x.fix) li.appendChild(t('span', `fix: ${x.fix}`, { class: 'fix', 'data-role': 'message-fix' }))
    }
  }
  const setBell = (open: boolean): void => {
    pop.setAttribute('class', open ? 'pop open' : 'pop')
    bell.setAttribute('aria-expanded', open ? 'true' : 'false')
    const c = (bell.getAttribute('class') ?? '').split(' ').filter((x) => x && x !== 'on')
    bell.setAttribute('class', (open ? [...c, 'on'] : c).join(' '))
    a.bellSet?.(bellKey, open)
  }
  bell.addEventListener('click', () => setBell(pop.getAttribute('class') !== 'pop open'))
  // The bell never stays over the panel's buttons: a press anywhere outside it, or Esc, closes it, and the press goes on
  // to what it was on (a pointerdown, so the click still reaches Try again).
  const closeOutside = (): void => {
    if (pop.getAttribute('class') === 'pop open') setBell(false)
  }
  const onKey = (e?: unknown): void => {
    if ((e as { key?: string } | undefined)?.key === 'Escape') closeOutside()
  }
  pop.addEventListener('keydown', onKey as () => void)
  bell.addEventListener('keydown', onKey as () => void)

  const body = root.appendChild(h('div', { class: 'body' }))
  const toolbar = h('footer', { class: 'toolbar', 'data-role': 'toolbar' })
  for (const el of [body, toolbar]) {
    el.addEventListener('pointerdown', closeOutside)
    el.addEventListener('keydown', onKey as () => void)
  }
  for (const b of [validate, refresh, logo]) b.addEventListener('pointerdown', closeOutside)

  // ---- P1: craftar missing, not starting or too old, said first ----
  if (install.length > 0) drawInstall(install)

  // ---- the worker's refusal of the panel's last request ----
  if (notice) {
    const n = body.appendChild(h('div', { class: 'notice' }))
    n.appendChild(t('p', notice, { class: 'note bad', 'data-role': 'notice' }))
    n.appendChild(closer('Close this message', () => a.clearNotice?.()))
  }

  // ---- Validate's report: the self-check's every line, then the probe's, as the worker wrote them ----
  if (v.probe && !dismissed.has(cardKey('probe', String(v.probe.at)))) {
    const box = body.appendChild(h('section', { class: 'card', 'data-role': 'probe' }))
    box.appendChild(cardHead('Validation', cardKey('probe', String(v.probe.at))))
    box.appendChild(t('p', `run ${new Date(v.probe.at).toLocaleTimeString()}: no file content; the terminal's last lines included`, { class: 'muted' }))
    box.appendChild(t('pre', v.probe.lines.join('\n'), { class: 'words', 'data-role': 'probe-text' }))
  }

  // ---- the self-check, on top when anything fails ----
  const checked = failing.filter((l) => l.install === undefined)
  const checkKey = cardKey('self-check', ...checked.map((l) => l.message))
  if (checked.length > 0 && !dismissed.has(checkKey)) {
    const bad = checked.some((l) => l.level === 'error')
    const box = body.appendChild(h('section', { class: `cta ${bad ? 'bad' : 'warn'}`, 'data-role': 'self-check' }))
    box.appendChild(cardHead('Self-check', checkKey))
    const ul = box.appendChild(h('ul', { class: 'lines' }))
    for (const l of checked) ul.appendChild(t('li', l.message, { class: l.level === 'error' ? 'err' : 'warn', 'data-role': 'check' }))
  }

  // ---- the body, by state ----
  if (v.focus === 'ask') drawAsk()
  else if (install.length > 0) {
    // The install card above says it all; nothing else to draw until craftar runs.
  } else if (broken) {
    body.appendChild(empty(true, 'craftar cannot be used', "The self-check above says why, in its own words. Install a craftar the self-check accepts, or set craftar binary in the plugin's settings to its absolute path."))
  } else if (v.readFailed) {
    const box = body.appendChild(h('section', { class: 'cta bad' }))
    box.appendChild(t('p', 'craftar status gave no document for this workspace. See the self-check, or run craftar status in a terminal.', { class: 'error' }))
    box.appendChild(h('div', { class: 'row' }, button('Check again', { class: 'btn', 'data-action': 'refresh' }, 'refresh', () => a.refresh())))
  } else if (!m) {
    if (v.focus === 'none') body.appendChild(empty(false, 'No craftar workspace has the focus', 'A workspace follows a Forge once it holds craftar.yaml. Start one in a terminal with craftar init.'))
    else body.appendChild(progress('craftar is reading this workspace…'))
  }

  if (m) {
    if (v.forgePr?.open) drawPrScreen(v.forgePr)
    else if (v.discard) drawDiscardScreen(v.discard)
    else if (v.sendAll) drawSendAllScreen(v.sendAll)
    else if (v.send) drawSendScreen(m, v.send)
    else drawMain(m)
    root.appendChild(toolbar)
  }

  if (!m) {
    const line = root.appendChild(h('div', { class: 'status-line', 'data-role': 'status-line' }))
    line.appendChild(t('span', broken ? 'craftar: not usable' : v.focus === 'ask' ? 'not read yet' : v.focus === 'none' ? 'no craftar.yaml in focus' : ''))
    line.appendChild(h('span', { class: 'spacer' }))
    if (version) line.appendChild(t('span', `craftar ${version}`))
  }

  // ---- pieces ----

  function tail(): void {
    if (diff) {
      const box = h('div', { class: 'diff' })
      if ('refused' in diff) box.appendChild(t('p', diff.refused, { class: 'error' }))
      else {
        box.appendChild(t('pre', diff.text, { class: 'words' }))
        if ((diff.warnings ?? []).length > 0) {
          const ul = box.appendChild(h('ul', { class: 'lines' }))
          for (const w of diff.warnings ?? []) ul.appendChild(t('li', w, { class: 'warn', 'data-role': 'warning' }))
        }
      }
      // The diff closes with its ×, with the row's diff button clicked again, or with Esc (panel.ts).
      const shownDiff = h('section', { class: 'sec', 'data-role': 'diff' })
      const head = shownDiff.appendChild(heading(diff.path, null))
      if (typeof a.closeDiff === 'function') head.appendChild(closer(`Close the diff of ${diff.path}`, () => a.closeDiff?.()))
      shownDiff.appendChild(box)
      body.appendChild(shownDiff)
    }
    if (v.remote.length > 0) {
      const ul = h('ul', { class: 'lst' })
      for (const r of v.remote) ul.appendChild(h('li', {}, t('span', r.name, { class: 'x' }), t('span', `${r.path} (on another host, not read)`, { class: 'a' })))
      body.appendChild(sec('On another host', v.remote.length, ul))
    }
  }
  if (!m) tail()

  function empty(bad: boolean, title: string, text: string): HTMLElement {
    const box = h('div', { class: 'empty' })
    // Item 1: the logo animated — the white square on top, linked to the orange and the blue one.
    const art = box.appendChild(s('svg', { class: bad ? 'art bad' : 'art', viewBox: '0 0 150 120', 'aria-hidden': 'true', focusable: 'false', 'data-role': 'empty-art' }))
    art.appendChild(s('path', { d: 'M75 42 V58 H35 V74', class: 'art-link o' }))
    art.appendChild(s('path', { d: 'M75 58 H115 V74', class: 'art-link b' }))
    const top = art.appendChild(s('g', { class: 'art-top' }))
    top.appendChild(s('rect', { x: '54', y: '4', width: '42', height: '36', rx: '7', class: 'art-box w' }))
    top.appendChild(s('path', { d: 'M63 17h22M63 26h14', class: 'art-bar w' }))
    art.appendChild(s('rect', { x: '14', y: '76', width: '42', height: '36', rx: '7', class: 'art-box o' }))
    art.appendChild(s('path', { d: 'M23 89h22M23 98h14', class: 'art-bar o' }))
    art.appendChild(s('rect', { x: '94', y: '76', width: '42', height: '36', rx: '7', class: 'art-box b' }))
    art.appendChild(s('path', { d: 'M103 89h22M103 98h14', class: 'art-bar b' }))
    box.appendChild(t('h2', title))
    box.appendChild(t('p', text))
    box.appendChild(h('div', { class: 'row' }, button('Check again', { class: bad ? 'btn primary' : 'btn', 'data-action': 'refresh' }, 'refresh', () => a.refresh())))
    return box
  }

  function drawAsk(): void {
    const box = body.appendChild(h('section', { class: 'cta plain ask' }))
    box.appendChild(t('h2', 'Which workspace are you working in?'))
    box.appendChild(t('p', 'Several craftar workspaces match the focused one in Orca. Pick the one this panel follows.'))
    const choice = box.appendChild(h('div', { class: 'choice' }))
    for (const r of v.ask) {
      const b = choice.appendChild(h('button', { class: 'btn', type: 'button', 'data-action': 'choose', 'data-id': r.id }))
      b.appendChild(icon('ws'))
      b.appendChild(h('span', {}, t('span', r.name, { class: 'nm' }), t('span', r.path, { class: 'pt' })))
      b.addEventListener('click', () => a.choose(r.id))
    }
  }

  function drawMain(m: PanelModel): void {
    drawDiagram(m)

    // ---- what craftar refuses, and what it asks ----
    const f = m.forge
    const refusedKey = cardKey('refused', ...refusalLines(m.unset))
    const checkFailedKey = cardKey('check-failed', ...m.errors, ...m.warnings)
    const fetchKey = cardKey('fetch-failed', String(f?.fetchedAt ?? ''), ...m.warnings)
    if (m.refused) {
      if (!dismissed.has(refusedKey)) {
        const box = body.appendChild(h('section', { class: 'cta bad', 'data-role': 'refused' }))
        box.appendChild(cardHead('craftar will not sync this workspace', refusedKey))
        box.appendChild(t('pre', refusalLines(m.unset).join('\n'), { class: 'words' }))
      }
    } else if (m.checkFailed) {
      // Once closed, the diagram still says "check failed" and the bell keeps craftar's words.
      if (!dismissed.has(checkFailedKey)) {
        const box = body.appendChild(h('section', { class: 'cta bad', 'data-role': 'check-failed' }))
        box.appendChild(cardHead('A check fails', checkFailedKey))
        box.appendChild(t('p', "craftar status exits 1: a check fails; craftar's messages (the bell) say why."))
      }
    } else if (cached && !dismissed.has(fetchKey)) {
      const box = body.appendChild(h('section', { class: 'cta bad', 'data-role': 'fetch-failed' }))
      box.appendChild(cardHead('The Forge could not be reached', fetchKey))
      const when = f?.fetchedAt ? new Date(f.fetchedAt).toLocaleString() : null
      box.appendChild(t('p', `What you see comes from the cached copy${when ? ` fetched ${when}` : ''}. Bringing files waits for a fetch that works; craftar's words are behind the bell.`))
      // Try again fetches: the periodic check, run now. A focus read is offline and could never clear this card.
      box.appendChild(h('div', { class: 'row' }, button('Try again', { class: 'btn', 'data-action': a.checkNow ? 'check-now' : 'refresh' }, 'refresh', () => (a.checkNow ? a.checkNow() : a.refresh()))))
    }
    // P3: while craftar syncs (a fetch, the sync, then the staging), a strip says so in words.
    if (v.sync?.phase === 'running') body.appendChild(progress('craftar is bringing the files from the Forge: fetching, syncing, then staging…'))
    if (v.consent) drawConsent(v.consent)
    // craftar's words about the last run; a consent refusal is said once, in the consent card above.
    const syncKey = cardKey('sync', v.sync?.phase ?? '', v.sync?.message ?? '')
    if (v.sync?.message && !(v.sync.phase === 'consent' && v.consent) && !dismissed.has(syncKey)) {
      const err = v.sync.phase === 'error'
      const box = body.appendChild(h('section', { class: err ? 'cta bad' : 'cta plain', 'data-role': err ? 'sync-error' : 'sync-note' }))
      if (err) box.appendChild(cardHead('The update did not finish', syncKey))
      box.appendChild(t('pre', v.sync.message, { class: 'words', 'data-role': 'sync-message' }))
    }

    // O7: files saved since the last read that craftar lists — a hint until drift show reads them.
    if (v.marked && v.marked.length > 0) {
      const box = body.appendChild(h('section', { class: 'cta plain', 'data-role': 'marked-box' }))
      const ul = box.appendChild(h('ul', { class: 'lines plain' }))
      for (const p of v.marked) ul.appendChild(t('li', `${p}: edited, not yet in the Forge`, { 'data-role': 'marked' }))
    }

    // S3b: a Forge PR left waiting (Back on its screen): continue it, or drop the steps left.
    if (v.forgePr && !v.forgePr.open) {
      const f = v.forgePr
      const box = body.appendChild(h('section', { class: 'card up', 'data-role': 'forgepr-waiting' }))
      box.appendChild(t('h2', 'A PR in the Forge waits'))
      box.appendChild(t('p', `${f.title} (${f.phase})`, { class: 'muted' }))
      box.appendChild(h('div', { class: 'row' },
        button('Continue', { class: 'btn ember', 'data-action': 'forgepr-show' }, 'up', () => a.forgePrShow?.(true)),
        button('Drop the steps left', { class: 'btn ghost', 'data-action': 'forgepr-drop', title: 'What is already done in the Forge stays as it is' }, null, () => a.forgePrDrop?.())))
    }

    // ---- the files, both directions (item 6) ----
    fileList('From the Forge', 'down', m.pending, (row) => t('span', row.state, { class: 'st' }))
    const needsClone = v.forgeDir?.needed === true && !v.forgeDir.dir
    const busy = v.send?.phase === 'writing' || v.send?.phase === 'checking'
    fileList('Edited here', 'up', m.edited, (row) => withDiscard(row, m,
      row.promotable
        ? typeof a.sendPreview === 'function' && !needsClone && !busy
          ? button('Send', { class: 'btn ember act', 'data-action': 'send-file', 'data-path': row.path }, 'up', () => a.sendPreview?.(row.path))
          : button('Send', { class: 'btn ember act', 'data-action': 'send-file', 'data-path': row.path, disabled: '', title: sendWhy(m) ?? 'craftar is working on a send' }, 'up', null)
        : row.reason
          ? t('span', row.reason, { class: 'why', ...(refusedSend.has(row.path) ? { title: refusedSend.get(row.path) ?? '', 'data-role': 'send-refused-why' } : {}) })
          : t('span', row.state, { class: 'st' })),
    )
    // craftar's refusal, in its words, under the files it concerns.
    const refusals = (shown?.edited ?? []).filter((e) => e.promotable && refusedSend.has(e.path))
    const refusalKey = cardKey('send-refused', ...refusals.map((e) => `${e.path}\u0000${refusedSend.get(e.path) ?? ''}`))
    if (refusals.length > 0 && !dismissed.has(refusalKey)) {
      const box = body.appendChild(h('section', { class: 'card bad', 'data-role': 'send-refused' }))
      box.appendChild(cardHead('craftar will not send', refusalKey))
      for (const e of refusals) {
        box.appendChild(t('p', e.path, { class: 'muted' }))
        box.appendChild(t('pre', refusedSend.get(e.path) ?? '', { class: 'words', 'data-role': 'send-refused-message' }))
      }
      box.appendChild(t('p', 'Kept here as you edited it. Save the file again, or click Check again, to ask craftar once more.', { class: 'muted' }))
    }
    fileList('Kept apart', 'apart', m.apart, (row) => withDiscard(row, m, t('span', row.state, { class: 'st' })))
    if (v.lastSync) drawLastSync(v.lastSync)
    tail()
    drawMainToolbar(m)
  }

  // Item 4: the site's diagram — the Forge, craftar sync, one card per surface, the workspace and its profile below.
  function drawDiagram(m: PanelModel): void {
    const f = m.forge
    const down = m.pending.length
    const blocked = m.edited.length - promotable
    const linkBroken = m.refused || m.checkFailed || cached
    const idle = !linkBroken && down === 0 && m.edited.length === 0 && m.apart.length === 0
    const dia = body.appendChild(h('div', { class: 'diagram', role: 'group', 'aria-label': 'Forge, craftar sync and this workspace' }))

    const forge = dia.appendChild(h('div', { class: 'node forge', 'data-role': 'forge' }))
    const source = f?.source ?? null
    const fname = source ? (source.replace(/[\\/]+$/, '').split(/[\\/:]/).pop() ?? source).replace(/\.git$/, '') : '(not shown)'
    const ft = forge.appendChild(h('div', { class: 't' }))
    ft.appendChild(t('span', 'forge', { class: 'em' }))
    ft.appendChild(t('span', fname || source || '(not shown)', { class: 'nm', ...(source ? { title: source } : {}) }))
    const when = f?.fetchedAt ? new Date(f.fetchedAt).toLocaleString() : null
    const fresh = f?.freshness === 'cached' ? ['warn', `cached copy${when ? ` · last fetched ${when}` : ''}`] : f?.freshness === 'fetched' ? ['ok', `fetched${when ? ` ${when}` : ''}`] : ['ok', 'on this machine']
    const fs = forge.appendChild(h('div', { class: 's' }))
    fs.appendChild(t('span', f?.ref ?? 'default branch'))
    fs.appendChild(t('span', ' @ '))
    fs.appendChild(t('span', short(f?.commit ?? null) ?? 'no commit', { class: 'em' }))
    if (source) forge.appendChild(t('div', source, { class: 's src' }))
    // Where the Forge was read from, on a line of its own under its path (the user's ask of 2026-11-08).
    forge.appendChild(h('div', { class: 'fresh', 'data-role': 'freshness' }, h('span', { class: `dot ${fresh[0]}` }), t('span', fresh[1])))
    // A ref that does not move: a change merged in the Forge comes here only with a new ref (the user's ask of 2026-11-08).
    // craftar 1.9.0 names a newer tag on the Forge than the ref: said in its words, with the way to move (the person edits the ref;
    // the user's decision of 2026-11-08). It stands for the pinned line, which would say the same.
    const newer = f?.newerTag ?? null
    if (newer) {
      const line = forge.appendChild(h('div', { class: 's pin newer', 'data-role': 'newer-tag' }))
      line.appendChild(t('span', `newer tag on the Forge: ${newer} (ref is ${f?.ref ?? 'an older tag'})${cached ? `, as of the last fetch${when ? ` ${when}` : ''}` : ''}. Set ref in craftar.yaml to move.`))
      if (typeof a.configOpen === 'function') line.appendChild(button('Open craftar.yaml', { class: 'btn ghost', 'data-action': 'config-open' }, null, () => a.configOpen?.()))
    } else {
      const pin = pinnedLine(f?.pinned ?? null, f?.ref ?? null)
      if (pin) forge.appendChild(t('div', pin, { class: 's pin', 'data-role': 'pinned' }))
    }

    dia.appendChild(h('div', { class: linkBroken ? 'stem broken' : 'stem' }))

    const sync = dia.appendChild(h('div', { class: 'node sync', 'data-role': 'sync-node' }))
    sync.appendChild(t('div', 'craftar sync', { class: 't' }))
    const state = sync.appendChild(h('div', { class: `flows ${linkBroken ? 'bad' : idle ? 'ok' : 'active'}`, 'data-role': 'sync-state' }))
    const flow = (c: string, ar: string, text: Kid, note: string | null): void => {
      const row = state.appendChild(h('div', { class: `flow ${c}` }))
      row.appendChild(t('span', ar, { class: 'ar' }))
      const tt = row.appendChild(h('span', { class: 'tx' }))
      if (text) tt.appendChild(typeof text === 'string' ? t('span', text) : text)
      if (note) row.appendChild(t('small', note))
    }
    if (linkBroken) {
      flow('bad', '✕', m.refused ? 'sync refused' : m.checkFailed ? 'check failed' : 'could not fetch the Forge', cached ? "showing the cached copy · craftar's messages (the bell) say why" : m.refused ? 'craftar says why below' : "craftar's messages (the bell) say why")
    } else if (idle) {
      flow('ok', '=', 'in sync', 'nothing to bring down, nothing to send up')
    } else {
      const lock = short(f?.lockCommit ?? null)
      const now = short(f?.commit ?? null)
      if (down > 0) flow('e', '↓', counted(down, ' coming down from the Forge'), lock && now && lock !== now ? `commit ${lock} → ${now}` : null)
      if (promotable > 0) flow('s', '↑', counted(promotable, ' can go up to the Forge'), blocked > 0 ? `${blocked} more edited here that craftar will not send (see why below)` : 'edited here by hand · kept on every sync')
      else if (blocked > 0) flow('off', '↑', 'nothing to send up', `${blocked} edited here that craftar will not send (see why below)`)
      if (down === 0 && m.edited.length === 0) flow('off', '!', `${plural(m.apart.length, 'file', 'files')} kept apart`, null)
    }

    if (m.outputs.length > 0) {
      const fan = dia.appendChild(s('svg', { class: linkBroken ? 'fan broken' : 'fan', viewBox: '0 0 300 20', preserveAspectRatio: 'none', 'aria-hidden': 'true', focusable: 'false' }))
      const n = m.outputs.length
      for (let i = 0; i < n; i++) {
        const x = ((i + 0.5) / n) * 300
        fan.appendChild(s('path', { d: `M150 0 C150 10 ${x} 8 ${x} 20` }))
      }
      const grid = dia.appendChild(h('ul', { class: `surfaces n${Math.min(n, 3)}${linkBroken ? ' dim' : ''}`, 'aria-label': 'Surfaces craftar writes' }))
      for (const o of m.outputs) {
        const c = o.counts
        const total = Object.values(c).reduce((x, y) => x + y, 0)
        const add = c.new ?? 0
        const upd = (c.update ?? 0) + (c.adopt ?? 0)
        const del = c.orphan ?? 0
        const edit = c.drift ?? 0
        const apart = (c.collision ?? 0) + (c['orphan-drift'] ?? 0)
        const [dot, word] = edit > 0 ? ['bad', 'drift'] : apart > 0 ? ['warn', 'kept apart'] : add + upd + del > 0 ? ['warn', 'outdated'] : ['ok', 'up to date']
        const what = [add > 0 ? `${add} new` : '', upd > 0 ? `${upd} to update` : '', del > 0 ? `${del} to remove` : '', edit > 0 ? `${edit} edited` : '', apart > 0 ? `${apart} apart` : '']
          .filter(Boolean)
          .join(', ')
        // craftar counts files per owner, and an owner can write in several places (claude-code also writes
        // .mcp.json): the card names the owner as craftar does, never a folder the panel would pick.
        const card = grid.appendChild(h('li', { class: 'surface', 'data-role': 'surface' }))
        card.appendChild(t('div', o.owner, { class: 't' }))
        card.appendChild(h('div', { class: 'st' }, h('span', { class: `dot ${dot}` }), t('span', word, { 'data-role': 'surface-state' })))
        card.appendChild(t('div', what || plural(total, 'file', 'files'), { class: 'f' }))
      }
    }

    const ws = dia.appendChild(h('div', { class: 'wsbar', 'data-role': 'workspace' }))
    ws.appendChild(h('div', { class: 't' }, t('span', 'workspace', { class: 'stc' }), t('span', m.name, { class: 'nm' })))
    const k = ws.appendChild(h('div', { class: 'k' }))
    k.appendChild(t('span', 'profile '))
    k.appendChild(t('span', f?.profile ?? 'unknown', { class: 'pf', 'data-role': 'profile' }))
    const lock = short(f?.lockCommit ?? null)
    if (lock) {
      k.appendChild(t('span', ' · lock '))
      k.appendChild(t('span', `forge@${lock}`, { class: 'lk' }))
    }
    ws.appendChild(t('div', m.ws, { class: 'k path' }))
  }

  function sendWhy(_m: PanelModel): string | null {
    if (typeof a.sendPreview !== 'function') return NOT_BUILT_SEND
    if (v.forgeDir?.needed === true && !v.forgeDir.dir) return NEEDS_CLONE
    if (v.send?.phase === 'writing' || v.send?.phase === 'checking') return 'craftar is working on a send'
    if (v.sendAll?.phase === 'writing' || v.sendAll?.phase === 'checking') return 'craftar is working on a send'
    return null
  }

  // Send all (design A, 2026-11-08): the dry run of every file and one plan; Write all writes them in order and stops at the
  // first refusal, in craftar's words, with the files not written listed; then the PR, and Send the rest after its commit.
  function drawSendAllScreen(sa: NonNullable<S3View['sendAll']>): void {
    const steps = body.appendChild(h('div', { class: 'steps', 'data-role': 'sendall-steps' }))
    const at = sa.phase === 'checking' ? 0 : sa.phase === 'plan' || sa.phase === 'writing' ? 1 : sa.phase === 'done' || sa.phase === 'stopped' ? 3 : -1
    ;['dry runs', 'write all', 'done'].forEach((name, i) => steps.appendChild(t('span', `${i + 1} ${name}`, { class: at < 0 ? '' : i < at ? 'done' : i === at ? 'on' : '' })))
    const planned = sa.items.filter((x) => x.plan)
    const written = sa.items.filter((x) => x.result)
    const refused = sa.items.filter((x) => x.refused !== null)
    const box = body.appendChild(h('section', { class: sa.phase === 'error' || sa.phase === 'stopped' ? 'card bad' : 'card up', 'data-role': 'sendall-box' }))
    const n = sa.items.length
    const title =
      sa.phase === 'checking' ? `craftar is checking ${n === 1 ? '1 file' : `${n} files`}: ${sa.current ?? ''}`
        : sa.phase === 'plan' ? `Send ${planned.length === 1 ? '1 file' : `${planned.length} files`} to the Forge?`
        : sa.phase === 'writing' ? `Writing ${written.length + 1} of ${planned.length}: ${sa.current ?? ''}`
        : sa.phase === 'done' ? `Written to the Forge's working tree: ${written.length === 1 ? '1 file' : `${written.length} files`}`
        : sa.phase === 'stopped' ? `${sa.stopped?.craftar === false ? 'craftar did not run' : 'craftar stopped'} at ${sa.stopped?.path ?? 'a file'}: ${written.length} of ${planned.length} written`
        : 'craftar did not run'
    box.appendChild(t('h2', title, { 'data-role': 'sendall-title' }))
    if (sa.phase === 'plan') box.appendChild(t('p', "Each plan is craftar's dry run against the Forge as it is now; the writes change it, so a later file can still be refused. Nothing is committed.", { class: 'muted' }))
    if (sa.phase === 'stopped' && sa.stopped) {
      // craftar's words in a block of their own; the plugin's own sentence (craftar did not run) as a plain line.
      box.appendChild(t(sa.stopped.craftar ? 'pre' : 'p', sa.stopped.message, { class: sa.stopped.craftar ? 'words' : 'note bad', 'data-role': 'sendall-stopped' }))
      box.appendChild(t('p', written.length > 0
        ? 'What was written stays in the Forge. Commit it with the PR\'s first step, then Send the rest: a refusal over a Forge file the write before left uncommitted clears once it is committed.'
        : 'Nothing was written. The files are back on the workspace; send them again after you looked at why.', { class: 'muted' }))
    }
    if (sa.phase === 'error' && sa.message) box.appendChild(t('pre', sa.message, { class: 'words', 'data-role': 'sendall-message' }))
    if (sa.more) box.appendChild(t('p', 'The rest of a Forge PR: its commit goes on the same branch.', { class: 'muted', 'data-role': 'sendall-more' }))
    // One section per file, in order: its plan (or result), or craftar's refusal of its dry run.
    for (const x of sa.items) {
      const p = x.result ?? x.plan
      const state = x.result ? 'written' : x.refused !== null ? 'refused' : sa.stopped?.path === x.path ? 'stopped here' : sa.remaining.includes(x.path) ? 'not written' : sa.current === x.path ? 'working' : x.plan ? 'planned' : 'waiting'
      const ul = h('ul', { class: 'lst' })
      if (p) {
        ul.appendChild(h('li', {}, t('span', `${p.outcome}: ${p.promoted}`, { class: 'x', 'data-role': 'sendall-outcome' })))
        for (const w of p.written) ul.appendChild(h('li', { 'data-role': 'sendall-written' }, t('span', w.path, { class: 'x' }), t('span', w.action, { class: 'a' })))
        for (const w of p.warnings) ul.appendChild(t('li', w, { class: 'warn', 'data-role': 'warning' }))
      }
      if (x.refused !== null) ul.appendChild(h('li', {}, t('pre', x.refused, { class: 'words', 'data-role': 'sendall-refused' })))
      body.appendChild(sec(`${x.path} · ${state}`, null, ul, { 'data-role': 'sendall-item' }))
    }
    if (sa.remaining.length > 0) {
      const ul = h('ul', { class: 'lst' })
      for (const p of sa.remaining) ul.appendChild(h('li', { 'data-role': 'sendall-remaining' }, t('span', p, { class: 'x' })))
      body.appendChild(sec('Not written yet', sa.remaining.length, ul))
    }
    toolbar.replaceChildren()
    const row = toolbar.appendChild(h('div', { class: 'tb' }))
    const cancel = (label: string): HTMLButtonElement => button(label, { class: 'btn ghost', 'data-action': 'sendall-cancel' }, null, () => a.sendAllCancel?.())
    if (sa.phase === 'plan') {
      row.appendChild(cancel('Cancel'))
      const attrs: Record<string, string> = { class: 'btn ember', 'data-action': 'sendall-confirm' }
      if (planned.length === 0) {
        attrs.disabled = ''
        attrs.title = 'craftar would send none of these files'
      }
      row.appendChild(button(`Write all ${planned.length}`, attrs, 'up', planned.length > 0 ? () => a.sendAllRun?.(planned.map((x) => x.path)) : null))
      toolbar.appendChild(t('p', `${refused.length > 0 ? `${refused.length} refused by craftar, kept here · ` : ''}writes the Forge's working tree, one file after another · nothing is committed`, { class: 'fnote' }))
    } else if (sa.phase === 'done' || sa.phase === 'stopped') {
      if (written.length > 0 && sa.more) {
        row.appendChild(cancel('Back to the PR'))
        row.appendChild(button(`Add ${written.length === 1 ? '1 file' : `${written.length} files`} to the PR`, { class: 'btn ember', 'data-action': 'forgepr-more' }, 'up', () => a.forgePrMore?.()))
      } else if (written.length > 0) {
        row.appendChild(cancel('Back to the workspace'))
        if (typeof a.forgePrPrepare === 'function') row.appendChild(button(`Prepare the PR for ${written.length === 1 ? '1 file' : `${written.length} files`}`, { class: 'btn ember', 'data-action': 'forgepr-prepare' }, 'up', () => a.forgePrPrepare?.()))
      } else row.appendChild(cancel(sa.more ? 'Back to the PR' : 'Back to the workspace'))
      toolbar.appendChild(t('p', 'each step of the PR in a terminal you see · the plugin never commits by itself', { class: 'fnote' }))
    } else if (sa.phase === 'error') row.appendChild(cancel(sa.more ? 'Back to the PR' : 'Back to the workspace'))
    else {
      if (sa.phase === 'checking') row.appendChild(cancel('Cancel'))
      row.appendChild(button(sa.phase === 'writing' ? 'Writing…' : 'Checking…', { class: 'btn ember', disabled: '', 'aria-busy': 'true' }, 'up', null))
    }
    tail()
  }

  // Item 5: the actions in a fixed footer toolbar, flat — bring from the Forge, send to the Forge.
  function drawMainToolbar(m: PanelModel): void {
    toolbar.replaceChildren()
    const u = v.update
    const files = u ? u.files.map((x) => x.path) : m.pending.map((x) => x.path)
    const n = files.length
    const running = v.sync?.phase === 'running'
    // A cached copy keeps Update disabled whatever the worker says (O10): the panel enforces it too.
    const allowed = u ? u.allowed && n > 0 && !running && !cached && !m.refused && !m.checkFailed && typeof a.updateRun === 'function' : false
    const reason = m.refused || m.checkFailed
      ? 'craftar refuses this workspace (see above)'
      : cached
        ? (u?.reason ?? 'needs a fetch that works')
        : u
          ? (u.reason ?? (running ? 'craftar is updating this workspace' : n === 0 ? 'the plugin has no file to update yet: check again' : typeof a.updateRun !== 'function' ? NOT_BUILT_UPDATE : null))
          : NOT_BUILT_UPDATE
    // A URL Forge needs a local clone before Send: asked for, or shown with Change, in the toolbar itself (the user's ask of 2026-11-08).
    if (promotable > 0 && v.forgeDir?.needed === true) drawForgeDir(v.forgeDir.dir)
    const row = toolbar.appendChild(h('div', { class: 'tb' }))
    if (m.pending.length > 0) {
      const attrs: Record<string, string> = { class: 'btn down', 'data-action': 'update' }
      if (!allowed) attrs.disabled = ''
      if (running) attrs['aria-busy'] = 'true'
      if (!allowed && reason) attrs.title = reason
      row.appendChild(button(running ? 'Bringing…' : `Bring ${n} from the Forge`, attrs, 'down', allowed ? () => drawBringScreen(m, files) : null))
    }
    const target = m.edited.find((e) => e.promotable)
    const why = sendWhy(m)
    if (promotable > 0) {
      const attrs: Record<string, string> = { class: 'btn ember', 'data-action': 'send' }
      if (why) {
        attrs.disabled = ''
        attrs.title = why
      }
      // drift promote carries one file at a time. With several, the footer sends them all (design A: one plan, the writes in
      // order); each row still sends its own file.
      if (promotable > 1 && typeof a.sendAllPreview === 'function') {
        attrs['data-action'] = 'send-all'
        row.appendChild(button(`Send all ${promotable} to the Forge`, attrs, 'up', !why ? () => a.sendAllPreview?.() : null))
      } else {
        const label = promotable === 1 ? 'Send 1 to the Forge' : `Send ${target ? target.path.slice(target.path.lastIndexOf('/') + 1) : 'a file'} to the Forge`
        if (target) attrs['data-path'] = target.path
        row.appendChild(button(label, attrs, 'up', !why && target ? () => a.sendPreview?.(target.path) : null))
      }
    }
    if (m.pending.length === 0 && promotable === 0) row.appendChild(t('span', 'Nothing to bring or send', { class: 'tb-empty', 'data-role': 'toolbar-empty' }))
    const notes: string[] = []
    if (m.pending.length > 0 && !allowed && reason) notes.push(reason)
    // The clone box above the buttons already says why Send waits; the note would repeat it.
    if (promotable > 0 && why && why !== NEEDS_CLONE) notes.push(why)
    if (notes.length > 0) for (const x of notes) toolbar.appendChild(t('p', x, { class: 'fnote', 'data-role': x === reason ? 'update-reason' : 'send-reason' }))
    else if (m.pending.length > 0 || promotable > 0) toolbar.appendChild(t('p', 'bring: writes and stages · send: dry run first · never a commit', { class: 'fnote' }))
  }

  // Item 9: Bring's confirmation — every file listed before it writes and stages.
  function drawBringScreen(m: PanelModel, files: string[]): void {
    body.replaceChildren()
    const card = body.appendChild(h('section', { class: 'card down', 'data-role': 'update-confirm-box' }))
    card.appendChild(t('h2', `Update ${plural(files.length, 'file', 'files')} and add ${files.length === 1 ? 'it' : 'them'} to your commit?`))
    const kept = m.edited.length + m.apart.length
    card.appendChild(t('p', `craftar syncs ${files.length === 1 ? 'it' : 'them'} from the Forge and stages exactly those paths and craftar.lock. Files you edited by hand are kept.`, { class: 'muted' }))
    const ul = h('ul', { class: 'lst' })
    for (const f of files) {
      const st = m.pending.find((p) => p.path === f)?.state ?? ''
      ul.appendChild(h('li', {}, t('span', f, { class: 'x', 'data-role': 'update-file' }), t('span', st, { class: 'a' })))
    }
    ul.appendChild(h('li', {}, t('span', 'craftar.lock', { class: 'x' }), t('span', 'staged too', { class: 'a' })))
    body.appendChild(sec('Written and staged', files.length, ul))
    if (kept > 0) {
      const kl = h('ul', { class: 'lst' })
      for (const e of [...m.edited, ...m.apart]) kl.appendChild(h('li', {}, t('span', e.path, { class: 'x' }), t('span', `${e.state} · kept`, { class: 'a' })))
      body.appendChild(sec('Kept as you edited it', kept, kl))
    }
    toolbar.replaceChildren()
    const row = toolbar.appendChild(h('div', { class: 'tb' }))
    row.appendChild(button('Cancel', { class: 'btn ghost', 'data-action': 'update-cancel' }, null, () => render(doc, root, v, a, diff, notice, forgeEdit)))
    row.appendChild(button('Update and stage', { class: 'btn down', 'data-action': 'update-confirm' }, 'down', () => a.updateRun?.(files)))
    toolbar.appendChild(t('p', 'never --overwrite-drift · never a commit', { class: 'fnote' }))
  }

  // Item 9: the send screen — the dry run's plan, the write on a second click, then what was written.
  function drawSendScreen(m: PanelModel, sd: NonNullable<S3View['send']>): void {
    const steps = body.appendChild(h('div', { class: 'steps', 'data-role': 'send-steps' }))
    const at = sd.phase === 'checking' ? 0 : sd.phase === 'preview' || sd.phase === 'writing' ? 1 : sd.phase === 'done' ? 3 : -1
    ;['dry run', 'write', 'done'].forEach((name, i) => steps.appendChild(t('span', `${i + 1} ${name}`, { class: at < 0 ? '' : i < at ? 'done' : i === at ? 'on' : '' })))
    const box = body.appendChild(h('section', { class: sd.phase === 'error' ? 'card bad' : 'card up', 'data-role': 'send-box' }))
    const plan = sd.phase === 'done' ? (sd.result ?? sd.plan) : sd.plan
    toolbar.replaceChildren()
    const row = toolbar.appendChild(h('div', { class: 'tb' }))
    const back = (): HTMLButtonElement => button('Back to the workspace', { class: 'btn', 'data-action': 'send-cancel' }, null, () => a.sendCancel?.())
    if (sd.phase === 'error') {
      box.appendChild(h('div', { class: 'card-h' }, t('h2', `craftar did not send ${sd.path}`), closer('Close and go back to the workspace', () => a.sendCancel?.())))
      if (sd.message) box.appendChild(t('pre', sd.message, { class: 'words', 'data-role': 'send-message' }))
      // A way out on the card itself as well as in the toolbar: a refusal never leaves the panel without one.
      box.appendChild(h('div', { class: 'row' }, button('Back to the workspace', { class: 'btn', 'data-action': 'send-cancel' }, null, () => a.sendCancel?.())))
      row.appendChild(back())
      tail()
      return
    }
    if (sd.phase === 'done') {
      box.setAttribute('class', 'ok-banner')
      box.appendChild(icon('check'))
      box.appendChild(h('div', {}, t('strong', "Written to the Forge's working tree"), t('div', `${sd.path}${plan ? ` is now ${plan.promoted}` : ''}. Nothing was committed.`, { class: 'muted' })))
    } else {
      box.appendChild(t('h2', sd.phase === 'writing' ? `Writing ${sd.path} to the Forge…` : sd.phase === 'checking' ? `craftar is checking ${sd.path}…` : `Send ${sd.path} to the Forge?`))
      if (plan) {
        const kv = box.appendChild(h('dl', { class: 'kv' }))
        const pair = (k: string, val: string, role?: string): void => {
          kv.appendChild(t('dt', k))
          kv.appendChild(t('dd', val, role ? { 'data-role': role } : {}))
        }
        pair('outcome', plan.outcome, 'send-outcome')
        pair('becomes', plan.promoted)
        if (m.forge?.profile) pair('profile', m.forge.profile)
      }
    }
    if (plan) {
      const lines = (title: string, items: [string, string][], role: string): void => {
        if (items.length === 0) return
        const ul = h('ul', { class: 'lst' })
        for (const [x, y] of items) ul.appendChild(h('li', { 'data-role': role }, t('span', x, { class: 'x' }), y ? t('span', y, { class: 'a' }) : null))
        body.appendChild(sec(title, items.length, ul))
      }
      lines(sd.phase === 'done' ? 'Written in the Forge' : 'craftar would write in the Forge', plan.written.map((w) => [w.path, w.action]), 'send-written')
      const shown = (x: unknown): string => (typeof x === 'string' ? x : JSON.stringify(x))
      lines('Values', plan.params.map((p) => [`${p.key}: ${shown(p.old)} → ${shown(p.value)}`, '']), 'send-param')
      lines('Sections', plan.sections.map((x) => [x.key, x.name]), 'send-section')
      // craftar's `flattened` is `{ params, sections }` (drift promote --json); a list that is not one reads as empty.
      const list = (x: unknown): unknown[] => (Array.isArray(x) ? x : [])
      lines('Written as plain text in the variant', [...list(plan.flattened?.params).map((k): [string, string] => [`param ${shown(k)}`, '']), ...list(plan.flattened?.sections).map((k): [string, string] => [`section ${shown(k)}`, ''])], 'send-flattened')
      lines('Depends on it', (plan.dependents ?? []).map((d): [string, string] => [d && typeof d === 'object' && 'ref' in d ? String((d as { ref: unknown }).ref) : shown(d), '']), 'send-dependent')
      const after: [string, string][] = []
      const counts = Object.entries(plan.nextSync?.counts ?? {}).map(([k, n]) => `${k} ${n}`)
      if (counts.length > 0) after.push(["this workspace's next sync", counts.join(', ')])
      after.push(['other workspaces on this Forge', plan.impact.workspaces.length > 0 ? `${plan.impact.workspaces.length} will see it on their next sync` : 'none'])
      if (sd.phase !== 'done') lines('After it', after, 'send-after')
      const says = h('ul', { class: 'lines' })
      for (const w of plan.warnings) says.appendChild(t('li', w, { class: 'warn', 'data-role': 'warning' }))
      if (plan.warnings.length === 0) says.appendChild(t('li', 'no warnings', { class: 'quiet' }))
      body.appendChild(sec('craftar says', plan.warnings.length, says))
    }
    if (sd.phase === 'done') body.appendChild(h('section', { class: 'card' }, t('p', 'Next: a PR in the Forge, in three clicks (branch and commit, push, open the PR), each in a terminal you see, after a preview of the identity git will use.', { class: 'muted' })))
    if (sd.phase === 'preview') {
      row.appendChild(button('Cancel', { class: 'btn ghost', 'data-action': 'send-cancel' }, null, () => a.sendCancel?.()))
      row.appendChild(button('Write to the Forge', { class: 'btn ember', 'data-action': 'send-confirm' }, 'up', () => a.sendRun?.(sd.path)))
      toolbar.appendChild(t('p', "writes the Forge's working tree · nothing is committed, pushed or opened as a PR", { class: 'fnote' }))
    } else if (sd.phase === 'done') {
      row.appendChild(back())
      if (typeof a.forgePrPrepare === 'function') row.appendChild(button('Prepare the PR', { class: 'btn ember', 'data-action': 'forgepr-prepare' }, 'up', () => a.forgePrPrepare?.()))
    }
    else row.appendChild(button(sd.phase === 'writing' ? 'Writing…' : 'Checking…', { class: 'btn ember', disabled: '', 'aria-busy': 'true' }, 'up', null))
    tail()
  }

  // Discard (spec 60 §8a): offered on a `drift` or `orphan-drift` row, never on the example settings file or a collision; with
  // anything pending it reads "Update first". The worker checks it all again; the panel only draws it.
  function withDiscard(row: { path: string; state: string }, m: PanelModel, right: HTMLElement): HTMLElement {
    if (typeof a.discardOpen !== 'function' || (row.state !== 'drift' && row.state !== 'orphan-drift') || row.path === EXAMPLE_SETTINGS) return right
    const pending = m.pending.length
    const busyHere = !!v.discard && (v.discard.phase === 'checking' || v.discard.phase === 'running')
    const attrs: Record<string, string> = { class: 'btn ghost act', 'data-action': 'discard-file', 'data-path': row.path }
    const off = v.discardOff ?? null
    if (off) {
      attrs.disabled = ''
      attrs.title = off
    } else if (pending > 0) {
      attrs.disabled = ''
      attrs.title = 'Update first: bring the files coming from the Forge with Update and stage, then discard'
    } else if (busyHere) {
      attrs.disabled = ''
      attrs.title = 'a discard is running'
    } else attrs.title = row.state === 'orphan-drift' ? 'Delete this file, which craftar no longer writes' : 'Put back what craftar writes for this file'
    // With files pending the action reads "Update first", pointing at Bring (Update and stage) in the toolbar.
    return h('span', { class: 'acts' }, right, button(!off && pending > 0 ? 'Update first' : 'Discard', attrs, null, off || pending > 0 || busyHere ? null : () => a.discardOpen?.(row.path)))
  }

  function drawDiscardScreen(d: NonNullable<View['discard']>): void {
    const box = body.appendChild(h('section', { class: d.phase === 'error' ? 'card bad' : 'card', 'data-role': 'discard-box' }))
    const name = d.path
    toolbar.replaceChildren()
    const row = toolbar.appendChild(h('div', { class: 'tb' }))
    const back = (label: string): HTMLButtonElement => button(label, { class: 'btn ghost', 'data-action': 'discard-cancel' }, null, () => a.discardCancel?.())
    if (d.phase === 'done') {
      const took = d.after?.file === (d.deleted ? 'gone' : 'unchanged')
      if (took) {
        box.setAttribute('class', 'ok-banner')
        box.appendChild(icon('check'))
        box.appendChild(h('div', {}, t('strong', d.deleted ? `${name} was deleted` : `${name} reads as craftar writes it`), t('div', `Now: ${d.after?.file ?? 'not read'}. Nothing was staged or committed.`, { class: 'muted', 'data-role': 'discard-after' })))
      } else {
        // craftar kept the file (it changed while craftar was writing, for one): said, with the discard offered again.
        box.setAttribute('class', 'card warn')
        box.appendChild(t('h2', `${name} was not put back`))
        box.appendChild(t('p', `Now: ${d.after?.file ?? 'not read'}. craftar's report below says why. Nothing was staged or committed.`, { class: 'muted', 'data-role': 'discard-after' }))
        if (typeof a.discardOpen === 'function') box.appendChild(h('div', { class: 'row' }, button('Discard again', { class: 'btn ember', 'data-action': 'discard-again' }, null, () => a.discardOpen?.(d.path))))
      }
      if (d.after && d.after.report !== '') body.appendChild(sec('craftar reported', null, t('pre', d.after.report, { class: 'words', 'data-role': 'discard-report' })))
      if (d.after && d.after.others.length > 0) {
        const ul = h('ul', { class: 'lines' })
        for (const o of d.after.others) ul.appendChild(t('li', o, { class: 'warn', 'data-role': 'discard-other' }))
        body.appendChild(sec('Also changed since the confirmation', d.after.others.length, ul))
      }
      if (d.after && d.after.warnings.length > 0) {
        const ul = h('ul', { class: 'lines' })
        for (const w of d.after.warnings) ul.appendChild(t('li', w, { class: 'warn', 'data-role': 'warning' }))
        body.appendChild(sec('craftar says', d.after.warnings.length, ul))
      }
      row.appendChild(back('Back to the workspace'))
      tail()
      return
    }
    if (d.phase === 'error') {
      box.appendChild(t('h2', `${name} was not discarded`))
      if (d.message) box.appendChild(t('pre', d.message, { class: 'words', 'data-role': 'discard-message' }))
      row.appendChild(back('Back to the workspace'))
      tail()
      return
    }
    box.appendChild(t('h2', d.deleted ? `Delete ${name}?` : `Discard your edit of ${name}?`))
    if (d.message) box.appendChild(t('p', d.message, { class: 'note bad', 'data-role': 'discard-note' }))
    box.appendChild(t('p', d.deleted
      ? 'craftar no longer writes this file: the discard deletes it, with your edit. This cannot be undone from the panel.'
      : 'The file goes back to what craftar writes for it (the diff below): your edit is lost for good. Nothing is staged or committed.', { class: 'muted' }))
    if (d.diff !== null) body.appendChild(sec('What changes', null, t('pre', d.diff, { class: 'words', 'data-role': 'discard-diff' })))
    else if (d.note) body.appendChild(sec('What changes', null, t('p', d.note, { class: 'muted', 'data-role': 'discard-withheld' })))
    if (d.phase === 'confirm') {
      row.appendChild(back('Cancel'))
      row.appendChild(button(d.deleted ? 'Delete the file' : 'Discard the edit', { class: 'btn ember', 'data-action': 'discard-confirm' }, null, () => a.discardRun?.(d.path)))
      toolbar.appendChild(t('p', 'the Forge is fetched first, then craftar drift discard runs on that copy · never --overwrite-drift', { class: 'fnote' }))
    } else row.appendChild(button(d.phase === 'checking' ? 'Fetching the Forge…' : 'Discarding…', { class: 'btn ember', disabled: '', 'aria-busy': 'true' }, null, null))
    tail()
  }

  // S3b: the PR in the Forge (spec 60 §8 step 4, O6): the preview, then three clicks, each in a terminal the person sees.
  function drawPrScreen(f: NonNullable<View['forgePr']>): void {
    const order: [string, string[]][] = [['1 branch and commit', ['committed', 'pushing', 'pushed', 'opening', 'opened']], ['2 push', ['pushed', 'opening', 'opened']], ['3 open the PR', ['opened']]]
    const runningAt: Record<string, number> = { committing: 0, pushing: 1, opening: 2 }
    const steps = body.appendChild(h('div', { class: 'steps', 'data-role': 'forgepr-steps' }))
    order.forEach(([name, done], i) => steps.appendChild(t('span', name, { class: done.includes(f.phase) ? 'done' : runningAt[f.phase] === i ? 'on' : '' })))
    const box = body.appendChild(h('section', { class: f.phase === 'failed' ? 'card bad' : 'card up', 'data-role': 'forgepr-box' }))
    box.appendChild(t('h2', f.phase === 'opened' ? 'The PR is open in the Forge' : 'A PR in the Forge'))
    const kv = box.appendChild(h('dl', { class: 'kv' }))
    const pair = (k: string, val: string, role: string): void => {
      kv.appendChild(t('dt', k))
      kv.appendChild(t('dd', val, { 'data-role': role }))
    }
    pair('identity', f.identity ?? (f.phase === 'preparing' ? 'reading it in a terminal…' : 'not read'), 'forgepr-identity')
    pair('from', f.forgeBranch ?? '(not read)', 'forgepr-from')
    pair('Forge', f.forge, 'forgepr-forge')
    const editing = f.phase === 'ready'
    let branchInput: HTMLInputElement | null = null
    let titleInput: HTMLInputElement | null = null
    if (editing) {
      branchInput = h('input', { type: 'text', 'data-role': 'forgepr-branch', 'aria-label': 'Branch in the Forge (lowercase letters, digits and hyphens)' }) as HTMLInputElement
      branchInput.value = prDraft?.branch ?? f.branch
      branchInput.addEventListener('input', () => a.forgePrDraft?.('branch', branchInput!.value))
      titleInput = h('input', { type: 'text', 'data-role': 'forgepr-title', 'aria-label': 'Commit subject and PR title' }) as HTMLInputElement
      titleInput.value = prDraft?.title ?? f.title
      titleInput.addEventListener('input', () => a.forgePrDraft?.('title', titleInput!.value))
      box.appendChild(t('p', 'Branch in the Forge', { class: 'muted' }))
      box.appendChild(branchInput)
      box.appendChild(t('p', 'Commit subject and PR title', { class: 'muted' }))
      box.appendChild(titleInput)
    } else {
      pair('branch', f.branch, 'forgepr-branch-text')
      pair('title', f.title, 'forgepr-title-text')
    }
    if (f.authorDiffers) box.appendChild(t('p', `The commit was made as ${f.authorDiffers}, not as the identity shown above.`, { class: 'note bad', 'data-role': 'forgepr-author' }))
    if (f.url) box.appendChild(t('p', `${f.url}${f.attached === true ? ' (attached to this workspace)' : f.attached === false ? ' (not attached: orca-ide reference add did not work)' : ''}`, { class: 'muted', 'data-role': 'forgepr-url' }))
    if (f.note) box.appendChild(t('p', f.note, { class: f.phase === 'failed' ? 'note bad' : 'note', 'data-role': 'forgepr-note' }))
    if (f.phase === 'words') {
      const ol = box.appendChild(h('ol', { class: 'lines plain' }))
      for (const step of f.steps) ol.appendChild(t('li', step, { 'data-role': 'forgepr-word' }))
    }
    const ul = h('ul', { class: 'lst' })
    for (const p of f.paths) ul.appendChild(h('li', { 'data-role': 'forgepr-path' }, t('span', p, { class: 'x' })))
    body.appendChild(sec('Committed, exactly these paths', f.paths.length, ul))
    body.appendChild(sec('PR body, written by the plugin', null, t('pre', f.body, { class: 'words', 'data-role': 'forgepr-body' })))

    toolbar.replaceChildren()
    const row = toolbar.appendChild(h('div', { class: 'tb' }))
    row.appendChild(button('Back to the workspace', { class: 'btn ghost', 'data-action': 'forgepr-back' }, null, () => a.forgePrShow?.(false)))
    const label: Record<string, [string, 'commit' | 'push' | 'pr']> = { ready: ['1 Branch and commit', 'commit'], committed: ['2 Push', 'push'], pushed: ['3 Open the PR', 'pr'] }
    const busy: Record<string, string> = { preparing: 'Reading…', committing: 'Committing…', pushing: 'Pushing…', opening: 'Opening…' }
    // Send all: after the commit, the files left go first (their commit joins the same branch), before the push.
    const rest = f.rest ?? []
    const adding = f.next ?? []
    if (!f.waiting && f.phase === 'committed' && adding.length > 0) {
      // The rest was added to the PR: its commit on the branch shown above is the next click, before the push.
      row.appendChild(button(`Commit ${adding.length === 1 ? '1 path' : `${adding.length} paths`} on ${f.branch}`, { class: 'btn ember', 'data-action': 'forgepr-commit-more' }, 'up', () => a.forgePrStep?.('commit')))
      const ul = h('ul', { class: 'lst' })
      for (const p of adding) ul.appendChild(h('li', { 'data-role': 'forgepr-next' }, t('span', p, { class: 'x' })))
      body.appendChild(sec('Next commit, on the same branch', adding.length, ul))
    } else if (!f.waiting && f.phase === 'committed' && rest.length > 0 && typeof a.sendAllRest === 'function') {
      row.appendChild(button(`Send the rest (${rest.length})`, { class: 'btn ember', 'data-action': 'sendall-rest' }, 'up', () => a.sendAllRest?.()))
      box.appendChild(t('p', `${rest.length === 1 ? '1 file was' : `${rest.length} files were`} not written yet: ${rest.join(', ')}. Send the rest before the push, or push without ${rest.length === 1 ? 'it' : 'them'}.`, { class: 'note', 'data-role': 'forgepr-rest' }))
    }
    if (f.waiting) row.appendChild(button('Check the terminal', { class: 'btn ember', 'data-action': 'forgepr-check' }, 'term', () => a.forgePrCheck?.()))
    else if (label[f.phase] && !(f.phase === 'committed' && adding.length > 0)) {
      const [text, step] = label[f.phase]
      row.appendChild(button(text, { class: 'btn ember', 'data-action': `forgepr-${step}` }, 'up', () => a.forgePrStep?.(step, branchInput?.value.trim(), titleInput?.value.trim())))
    } else if (f.phase === 'failed' && f.step) {
      const step = f.step
      row.appendChild(button(`Try ${step === 'pr' ? 'the PR' : step === 'prepare' ? 'the preview' : step} again`, { class: 'btn ember', 'data-action': `forgepr-${step}` }, 'up', () => a.forgePrStep?.(step)))
    } else if (busy[f.phase]) row.appendChild(button(busy[f.phase], { class: 'btn ember', disabled: '', 'aria-busy': 'true' }, 'up', null))
    if (f.phase === 'words' || f.phase === 'failed' || f.waiting) row.appendChild(button('Drop', { class: 'btn ghost', 'data-action': 'forgepr-drop', title: 'What is already done in the Forge stays as it is' }, null, () => a.forgePrDrop?.()))
    toolbar.appendChild(t('p', 'each step in a terminal you see · push and PR are separate clicks · the plugin never commits by itself', { class: 'fnote' }))
    tail()
  }

  function drawForgeDir(dir: string | null): void {
    // One slot in the toolbar: the stored folder with Change, or the box to type one. Change opens the box filled with the
    // stored folder, and Cancel puts the stored folder back without changing anything (the user's ask of 2026-11-08).
    const slot = toolbar.appendChild(h('div', { class: 'tb-clone-slot' }))
    const stored = (): void => {
      if (!dir) return
      slot.replaceChildren(
        h(
          'div',
          { class: 'row clone', 'data-role': 'forge-dir-stored' },
          t('span', `Forge clone: ${dir}`, { class: 'muted' }),
          button('Change', { class: 'btn ghost', 'data-action': 'forge-dir-change' }, null, () => (a.forgeDirEdit ? a.forgeDirEdit(dir) : edit(dir))),
        ),
      )
    }
    const edit = (draft: string | null): void => {
      const box = h('div', { class: 'tb-clone', 'data-role': 'forge-dir' })
      box.appendChild(t('p', 'This Forge is a git URL. Type the folder of a local clone of it: craftar writes the change there, never a commit; the plugin keeps only this path.', { class: 'fnote left' }))
      const input = h('input', { type: 'text', 'data-role': 'forge-dir-input', placeholder: '/path/to/a/clone/of/the/forge', 'aria-label': 'Folder of a local clone of the Forge' }) as HTMLInputElement
      if (draft) input.value = draft
      input.addEventListener('input', () => a.forgeDirDraft?.(input.value))
      const row = box.appendChild(h('div', { class: 'tb' }, input))
      if (dir) row.appendChild(button('Cancel', { class: 'btn ghost', 'data-action': 'forge-dir-cancel' }, null, () => (a.forgeDirEdit ? a.forgeDirEdit(null) : stored())))
      row.appendChild(button('Use this folder', { class: 'btn ghost', 'data-action': 'forge-dir-save' }, null, () => a.forgeDirSet?.(input.value.trim())))
      slot.replaceChildren(box)
    }
    // The box Change opened survives every redraw (a periodic read, a save): panel.ts keeps it in `forgeEdit`.
    if (dir && forgeEdit === null) stored()
    else edit(forgeEdit ?? dir)
  }

  function counted(n: number, rest: string): HTMLElement {
    const span = h('span')
    span.appendChild(t('strong', String(n)))
    span.appendChild(t('span', rest))
    return span
  }

  /** P3: craftar at work, said in words, with an indeterminate bar (still under reduced motion). */
  function progress(text: string): HTMLElement {
    const box = h('div', { class: 'progress', role: 'status', 'aria-live': 'polite', 'data-role': 'progress' })
    box.appendChild(t('span', text))
    box.appendChild(h('span', { class: 'bar', 'aria-hidden': 'true' }))
    return box
  }

  function drawInstall(lines: Line[]): void {
    const kind = lines[0].install
    const box = body.appendChild(h('section', { class: 'cta bad', 'data-role': 'install' }))
    box.appendChild(t('h2', kind === 'old' ? 'craftar is too old for this plugin' : kind === 'broken' ? 'craftar is installed but does not start' : 'craftar is not installed, or the plugin cannot find it'))
    // The self-check's own words first, as it wrote them.
    for (const l of lines) box.appendChild(t('p', l.message, { class: 'note bad', 'data-role': 'install-why' }))
    const how = box.appendChild(h('p'))
    how.appendChild(t('span', kind === 'old' ? 'Upgrade it in a terminal: ' : 'Install it in a terminal: '))
    how.appendChild(t('code', 'npm install -g craftar', { 'data-role': 'install-line' }))
    how.appendChild(t('span', ' (it needs Node 22 or later).'))
    if (kind === 'missing') {
      box.appendChild(t('p', "The plugin looks at the craftar binary setting, else at the absolute entries of Orca's PATH. If craftar runs in your terminal but not here (installed with nvm, for one, which puts it on an interactive shell's PATH only), set craftar binary in the plugin's settings to its absolute path: command -v craftar prints it."))
    } else if (kind === 'broken') {
      box.appendChild(t('p', "craftar starts with node: Node 22 or later must be on Orca's PATH too, not only on your terminal's."))
    }
    box.appendChild(h('div', { class: 'row' }, button('Check again', { class: 'btn', 'data-action': 'install-check' }, 'refresh', () => (a.validate ? a.validate() : a.refresh()))))
  }

  function drawConsent(c: NonNullable<S2View['consent']>): void {
    // P3: craftar printed that it recorded the consent in the terminal the plugin opened: the question is answered.
    if (c.answer === 'recorded') {
      const ok = body.appendChild(h('section', { class: 'cta plain', 'data-role': 'consent-recorded' }))
      ok.appendChild(t('h2', 'Writes are allowed here'))
      ok.appendChild(t('p', 'craftar recorded your yes. Click Bring from the Forge again: it asks nothing more.'))
      return
    }
    const box = body.appendChild(h('section', { class: 'cta plain', 'data-role': 'consent' }))
    box.appendChild(t('h2', 'craftar asks before it writes here'))
    box.appendChild(t('pre', c.text, { class: 'words' }))
    if (c.answer === 'cancelled') {
      box.appendChild(t('p', 'You answered no in the terminal: nothing was recorded, and nothing was written. Open the terminal again to answer yes.', { class: 'note', 'data-role': 'consent-cancelled' }))
    }
    // P2: what the terminal will show and ask, read before it opens. The question is craftar's own words, verbatim.
    const explain = box.appendChild(h('div', { class: 'note bad consent-explain', 'data-role': 'consent-explain' }))
    explain.appendChild(t('p', "The terminal shows this workspace's Forge, the ref and the profile, then craftar asks:"))
    explain.appendChild(t('pre', CONSENT_QUESTION, { class: 'words' }))
    const yes = explain.appendChild(h('p'))
    yes.appendChild(t('strong', 'To allow writes, type yes and press Enter.'))
    yes.appendChild(t('span', ' Enter alone, or no, answers no and writes nothing. The plugin never answers for you.'))
    if (c.terminal === 'offered') {
      box.appendChild(h('div', { class: 'row' }, button('Open a terminal to allow writes', { class: 'btn', 'data-action': 'consent-terminal' }, 'term', () => a.consentTerminal?.())))
      if (c.note) box.appendChild(t('p', c.note, { class: 'note', 'data-role': 'consent-note' }))
    } else {
      const ol = box.appendChild(h('ol', { class: 'lines plain' }))
      for (const step of c.steps) ol.appendChild(t('li', step))
    }
  }

  function drawLastSync(l: NonNullable<S2View['lastSync']>): void {
    const box = h('div', { class: 'last' })
    box.appendChild(t('p', `${plural(l.written.length, 'file', 'files')} written, ${plural(l.removed.length, 'file', 'files')} removed, ${plural(l.staged.length, 'path', 'paths')} staged.`, { class: 'muted' }))
    const list = (title: string, items: { text: string; role: string; cls?: string }[]): void => {
      if (items.length === 0) return
      box.appendChild(t('h4', title))
      const ul = box.appendChild(h('ul', { class: 'lines plain' }))
      for (const i of items) ul.appendChild(t('li', i.text, { 'data-role': i.role, ...(i.cls ? { class: i.cls } : {}) }))
    }
    list('Written', l.written.map((x) => ({ text: x, role: 'written' })))
    list('Staged', l.staged.map((x) => ({ text: x, role: 'staged' })))
    list('Left out of the commit (ignored by git, or never tracked)', (l.leftOut ?? []).map((x) => ({ text: x, role: 'left-out' })))
    list('Removed', l.removed.map((x) => ({ text: `${x.path} · ${x.reason}`, role: 'removed' })))
    list('Kept', l.kept.map((x) => ({ text: `${x.path} · ${x.state}${x.reason ? ` · ${x.reason}` : ''}`, role: 'kept' })))
    list('Changed since the question', l.differences.map((x) => ({ text: x, role: 'difference', cls: 'warn' })))
    list('craftar says', l.warnings.map((x) => ({ text: x, role: 'warning', cls: 'warn' })))
    if (l.rerun) box.appendChild(t('p', 'craftar kept a file that changed while it was writing. Bring the files again.', { class: 'note', 'data-role': 'rerun' }))
    body.appendChild(sec('Last update', null, box, { 'data-role': 'last-sync' }))
  }

  function fileList<T extends { path: string; state: string }>(title: string, dir: 'down' | 'up' | 'apart', rows: T[], right: (row: T) => HTMLElement): void {
    if (rows.length === 0) return
    const ul = h('ul', { class: 'files' })
    for (const row of rows) {
      const li = ul.appendChild(h('li'))
      const i = row.path.lastIndexOf('/')
      const [folder, fn] = i < 0 ? ['', row.path] : [row.path.slice(0, i + 1), row.path.slice(i + 1)]
      const [c, mark] = STATE_ICON[row.state] ?? STATE_ICON.update
      // A click opens the file in Orca's editor (the user's ask of 2026-11-08); a file the Forge brings that is not here yet
      // has nothing to open, so its click shows craftar's diff. The diff stays one small button away on every row.
      const opens = typeof a.openFile === 'function' && row.state !== 'new'
      const b = li.appendChild(h('button', { class: 'file', type: 'button', title: opens ? 'Open in Orca' : 'Show the diff', 'data-action': opens ? 'open' : 'diff', 'data-path': row.path }))
      b.appendChild(t('span', dir === 'down' ? '↓' : dir === 'up' ? '↑' : '!', { class: `arrow ${dir}`, 'aria-hidden': 'true' }))
      b.appendChild(t('span', mark, { class: `ic ${c}`, 'aria-hidden': 'true' }))
      b.appendChild(h('span', { class: 'name' }, t('span', fn, { class: 'fn' }), folder ? t('span', folder, { class: 'dir' }) : null))
      b.addEventListener('click', () => (opens ? a.openFile?.(row.path) : a.showDiff(row.path)))
      if (opens) {
        const d = li.appendChild(h('button', { class: 'icon-btn row-diff', type: 'button', title: "Show craftar's diff", 'aria-label': `Show craftar's diff of ${row.path}`, 'data-action': 'diff', 'data-path': row.path }))
        d.appendChild(icon('diff'))
        d.addEventListener('click', () => a.showDiff(row.path))
      }
      li.appendChild(right(row))
    }
    body.appendChild(sec(title, rows.length, ul, { 'data-role': `list-${dir}` }))
  }
}

/** The Forge card's line for a ref that does not move, or null. Fixed words and craftar's ref only. */
export function pinnedLine(pinned: 'tag' | 'commit' | null, ref: string | null): string | null {
  if (pinned === 'tag' && ref) return `tag ${ref} does not move: a change merged in the Forge comes here once a newer tag is set as ref in craftar.yaml`
  if (pinned === 'commit') return 'a commit does not move: a change merged in the Forge comes here once a newer ref is set in craftar.yaml'
  return null
}
