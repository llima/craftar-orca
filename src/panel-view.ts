// The panel's drawing (spec 60 §6), as a function of the worker's view, in the layout the user approved on
// 2026-11-08 (the mockup of the nine layout items): a header with the messages bell and Check again; the sync
// diagram as the site draws it — the Forge, craftar sync, one card per surface (craftar's owners) and the
// workspace with its profile below; the files in both directions; the actions in a fixed footer toolbar. Send
// and Bring each take the body over with their own screen and their own toolbar. Every value is put in with
// textContent, never as markup.
import type { UnsetParam } from './craftar'
import type { PanelModel } from './model'
import type { View } from './worker'
import { cachedAgeLine, classify, counted as needsLook, type Message } from './messages'

const SVG = 'http://www.w3.org/2000/svg'

/** S2's additions to the view (agent 58's contract, 2026-11-07): optional here until the worker sends them. */
export interface S2View {
  update?: { allowed: boolean; reason: string | null; files: { path: string; state: string }[] }
  sync?: { phase: 'idle' | 'running' | 'consent' | 'done' | 'error'; message: string | null }
  consent?: { text: string; terminal: 'offered' | 'words'; steps: string[]; note?: string | null } | null
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
export type PanelView = Omit<View, 'update' | 'sync' | 'consent' | 'lastSync' | 'send' | 'forgeDir' | 'marked' | 'sendRefused' | 'dismissed' | 'messagesCleared' | 'validating'> & S2View & S3View & BellView

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
  /** The diff shown in the panel closed (its ×, its row's button again, or Esc). */
  closeDiff?(): void
  /** S2: `update.run` with the paths the confirm listed. */
  updateRun?(files: string[]): void
  /** S2: `consent.terminal`. */
  consentTerminal?(): void
  /** S3a: `send.preview` (the dry run), `send.run` (the write, second click), `send.cancel`, `forge.dir.set`. */
  sendPreview?(path: string): void
  sendRun?(path: string): void
  sendCancel?(): void
  forgeDirSet?(dir: string): void
  /** The bell: `card.dismiss` (a card closed with ×), `messages.clear`, `validate.run`; the panel's own notice closed. */
  dismiss?(key: string): void
  messagesClear?(): void
  validate?(): void
  clearNotice?(): void
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
export function render(doc: Doc, root: HTMLElement, v: PanelView, a: Actions, diff: DiffShown = null, notice: string | null = null): void {
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
  // Item 8: craftar's warnings and errors behind a bell; opened at once when craftar reports an error.
  const openAtStart = !!m && !cleared && (m.errors.length > 0 || m.refused || m.checkFailed || cached)
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
  bell.addEventListener('click', () => {
    const open = pop.getAttribute('class') === 'pop open'
    pop.setAttribute('class', open ? 'pop' : 'pop open')
    bell.setAttribute('aria-expanded', open ? 'false' : 'true')
    const c = (bell.getAttribute('class') ?? '').split(' ').filter((x) => x && x !== 'on')
    bell.setAttribute('class', (open ? c : [...c, 'on']).join(' '))
  })

  const body = root.appendChild(h('div', { class: 'body' }))
  const toolbar = h('footer', { class: 'toolbar', 'data-role': 'toolbar' })

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
  const checkKey = cardKey('self-check', ...failing.map((l) => l.message))
  if (failing.length > 0 && !dismissed.has(checkKey)) {
    const bad = failing.some((l) => l.level === 'error')
    const box = body.appendChild(h('section', { class: `cta ${bad ? 'bad' : 'warn'}`, 'data-role': 'self-check' }))
    box.appendChild(cardHead('Self-check', checkKey))
    const ul = box.appendChild(h('ul', { class: 'lines' }))
    for (const l of failing) ul.appendChild(t('li', l.message, { class: l.level === 'error' ? 'err' : 'warn', 'data-role': 'check' }))
  }

  // ---- the body, by state ----
  if (v.focus === 'ask') drawAsk()
  else if (broken) {
    body.appendChild(empty(true, 'craftar cannot be used', "The self-check above says why, in its own words. Install a craftar the self-check accepts, or set craftar binary in the plugin's settings to its absolute path."))
  } else if (v.readFailed) {
    const box = body.appendChild(h('section', { class: 'cta bad' }))
    box.appendChild(t('p', 'craftar status gave no document for this workspace. See the self-check, or run craftar status in a terminal.', { class: 'error' }))
    box.appendChild(h('div', { class: 'row' }, button('Check again', { class: 'btn', 'data-action': 'refresh' }, 'refresh', () => a.refresh())))
  } else if (!m) {
    if (v.focus === 'none') body.appendChild(empty(false, 'No craftar workspace has the focus', 'A workspace follows a Forge once it holds craftar.yaml. Start one in a terminal with craftar init.'))
    else body.appendChild(t('p', 'Reading…', { class: 'muted' }))
  }

  if (m) {
    if (v.send) drawSendScreen(m, v.send)
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
      box.appendChild(h('div', { class: 'row' }, button('Try again', { class: 'btn', 'data-action': 'refresh' }, 'refresh', () => a.refresh())))
    }
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

    // ---- the files, both directions (item 6) ----
    fileList('From the Forge', 'down', m.pending, (row) => t('span', row.state, { class: 'st' }))
    const needsClone = v.forgeDir?.needed === true && !v.forgeDir.dir
    const busy = v.send?.phase === 'writing' || v.send?.phase === 'checking'
    fileList('Edited here', 'up', m.edited, (row) =>
      row.promotable
        ? typeof a.sendPreview === 'function' && !needsClone && !busy
          ? button('Send', { class: 'btn ember act', 'data-action': 'send-file', 'data-path': row.path }, 'up', () => a.sendPreview?.(row.path))
          : button('Send', { class: 'btn ember act', 'data-action': 'send-file', 'data-path': row.path, disabled: '', title: sendWhy(m) ?? 'craftar is working on a send' }, 'up', null)
        : row.reason
          ? t('span', row.reason, { class: 'why', ...(refusedSend.has(row.path) ? { title: refusedSend.get(row.path) ?? '', 'data-role': 'send-refused-why' } : {}) })
          : t('span', row.state, { class: 'st' }),
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
    fileList('Kept apart', 'apart', m.apart, (row) => t('span', row.state, { class: 'st' }))
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
    ft.appendChild(h('span', { class: 'fresh', 'data-role': 'freshness' }, h('span', { class: `dot ${fresh[0]}` }), t('span', fresh[1])))
    const fs = forge.appendChild(h('div', { class: 's' }))
    fs.appendChild(t('span', f?.ref ?? 'default branch'))
    fs.appendChild(t('span', ' @ '))
    fs.appendChild(t('span', short(f?.commit ?? null) ?? 'no commit', { class: 'em' }))
    if (source) forge.appendChild(t('div', source, { class: 's src' }))

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
    return null
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
      // drift promote carries one file at a time: with several, the button names the one it sends (the rows send the others).
      const label = promotable === 1 ? 'Send 1 to the Forge' : `Send ${target ? target.path.slice(target.path.lastIndexOf('/') + 1) : 'a file'} to the Forge`
      if (target) attrs['data-path'] = target.path
      row.appendChild(button(label, attrs, 'up', !why && target ? () => a.sendPreview?.(target.path) : null))
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
    row.appendChild(button('Cancel', { class: 'btn ghost', 'data-action': 'update-cancel' }, null, () => render(doc, root, v, a, diff, notice)))
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
    if (sd.phase === 'done') body.appendChild(h('section', { class: 'card' }, t('p', 'Next: commit and open a PR in the Forge, a later step, in a terminal you see, one click each. Until then, use git in the Forge.', { class: 'muted' })))
    if (sd.phase === 'preview') {
      row.appendChild(button('Cancel', { class: 'btn ghost', 'data-action': 'send-cancel' }, null, () => a.sendCancel?.()))
      row.appendChild(button('Write to the Forge', { class: 'btn ember', 'data-action': 'send-confirm' }, 'up', () => a.sendRun?.(sd.path)))
      toolbar.appendChild(t('p', "writes the Forge's working tree · nothing is committed, pushed or opened as a PR", { class: 'fnote' }))
    } else if (sd.phase === 'done') row.appendChild(back())
    else row.appendChild(button(sd.phase === 'writing' ? 'Writing…' : 'Checking…', { class: 'btn ember', disabled: '', 'aria-busy': 'true' }, 'up', null))
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
          button('Change', { class: 'btn ghost', 'data-action': 'forge-dir-change' }, null, () => edit()),
        ),
      )
    }
    const edit = (): void => {
      const box = h('div', { class: 'tb-clone', 'data-role': 'forge-dir' })
      box.appendChild(t('p', 'This Forge is a git URL. Type the folder of a local clone of it: craftar writes the change there, never a commit; the plugin keeps only this path.', { class: 'fnote left' }))
      const input = h('input', { type: 'text', 'data-role': 'forge-dir-input', placeholder: '/path/to/a/clone/of/the/forge', 'aria-label': 'Folder of a local clone of the Forge' }) as HTMLInputElement
      if (dir) input.value = dir
      const row = box.appendChild(h('div', { class: 'tb' }, input))
      if (dir) row.appendChild(button('Cancel', { class: 'btn ghost', 'data-action': 'forge-dir-cancel' }, null, () => stored()))
      row.appendChild(button('Use this folder', { class: 'btn ghost', 'data-action': 'forge-dir-save' }, null, () => a.forgeDirSet?.(input.value.trim())))
      slot.replaceChildren(box)
    }
    if (dir) stored()
    else edit()
  }

  function counted(n: number, rest: string): HTMLElement {
    const span = h('span')
    span.appendChild(t('strong', String(n)))
    span.appendChild(t('span', rest))
    return span
  }

  function drawConsent(c: NonNullable<S2View['consent']>): void {
    const box = body.appendChild(h('section', { class: 'cta plain', 'data-role': 'consent' }))
    box.appendChild(t('h2', 'craftar asks before it writes here'))
    box.appendChild(t('pre', c.text, { class: 'words' }))
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
