// The panel's drawing (spec 60 §6), as a function of the worker's view, in the approved design (agent 62,
// the user's approval of 2026-11-07): a header with one state pill, the Forge → workspace tree whose link
// carries two lanes (down ember, up steel), the cards that ask, flat file lists, linked projects, craftar's
// words verbatim and a footer. Every value is put in with textContent, never as markup.
// S2's fields (update, sync, consent, lastSync) come from the worker, and Update and the consent terminal
// call its update.run and consent.terminal; a panel without those actions draws Update disabled with a note.
// Send to Forge is S3's.
import type { UnsetParam } from './craftar'
import type { PanelModel } from './model'
import type { View } from './worker'

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
export type PanelView = Omit<View, 'update' | 'sync' | 'consent' | 'lastSync' | 'send' | 'forgeDir' | 'marked'> & S2View & S3View

export interface Actions {
  choose(id: string): void
  refresh(): void
  showDiff(path: string): void
  /** S2: `update.run` with the paths the confirm listed. */
  updateRun?(files: string[]): void
  /** S2: `consent.terminal`. */
  consentTerminal?(): void
  /** S3a: `send.preview` (the dry run), `send.run` (the write, second click), `send.cancel`, `forge.dir.set`. */
  sendPreview?(path: string): void
  sendRun?(path: string): void
  sendCancel?(): void
  forgeDirSet?(dir: string): void
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
  flattened?: unknown[]
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
  down: 'M8 2.5v10M3.5 8.5 8 13l4.5-4.5',
  up: 'M8 13.5v-10M3.5 7.5 8 3l4.5 4.5',
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

const NOT_BUILT_UPDATE = 'Update and stage is not built yet in this version of the plugin — until then, run craftar sync in a terminal.'
const NOT_BUILT_SEND = 'Send to Forge is not built yet in this version of the plugin.'

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
  const sec = (title: string, n: number | null, body: Node, attrs: Record<string, string> = {}): HTMLElement => {
    const box = h('section', { class: 'sec', ...attrs })
    const head = box.appendChild(h('h3'))
    head.appendChild(t('span', title))
    if (n !== null) head.appendChild(t('span', String(n), { class: 'n' }))
    head.appendChild(h('span', { class: 'line' }))
    box.appendChild(body)
    return box
  }
  root.replaceChildren()

  const m = v.focus === 'one' ? v.model : null
  const failing = v.selfCheck.filter((l) => l.level !== 'ok')
  const broken = !v.model && failing.some((l) => l.level === 'error')
  const promotable = m ? m.edited.filter((e) => e.promotable).length : 0
  const cached = m?.forge?.freshness === 'cached'
  const version = v.selfCheck.map((l) => /^version (\S+)$/.exec(l.message)?.[1]).find((x) => x !== undefined) ?? null

  // ---- header ----
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
  if (m) h1.appendChild(t('span', `/ ${m.name}`, { class: 'ws-name' }))
  header.appendChild(h('span', { class: 'spacer' }))
  const p = statePill()
  if (p) header.appendChild(t('span', p[1], { class: `pill ${p[0]}`, 'data-role': 'state-pill' }))
  const refresh = header.appendChild(h('button', { class: 'icon-btn', type: 'button', title: 'Check again', 'aria-label': 'Check again', 'data-action': 'refresh' }))
  refresh.appendChild(icon('refresh'))
  refresh.addEventListener('click', () => a.refresh())

  // ---- the worker's refusal of the panel's last request ----
  if (notice) root.appendChild(t('p', notice, { class: 'note bad', 'data-role': 'notice' }))

  // ---- the self-check, on top when anything fails ----
  if (failing.length > 0) {
    const bad = failing.some((l) => l.level === 'error')
    const box = root.appendChild(h('section', { class: `cta ${bad ? 'bad' : 'warn'}`, 'data-role': 'self-check' }))
    box.appendChild(t('h2', 'Self-check'))
    const ul = box.appendChild(h('ul', { class: 'lines' }))
    for (const l of failing) ul.appendChild(t('li', l.message, { class: l.level === 'error' ? 'err' : 'warn', 'data-role': 'check' }))
  }

  // ---- the body, by state ----
  if (v.focus === 'ask') drawAsk()
  else if (broken) {
    root.appendChild(empty(true, 'craftar cannot be used', 'The self-check above says why, in its own words. Install a craftar the self-check accepts, or set craftar binary in the plugin\'s settings to its absolute path.'))
  } else if (v.readFailed) {
    const box = root.appendChild(h('section', { class: 'cta bad' }))
    box.appendChild(t('p', 'craftar status gave no document for this workspace — see the self-check, or run craftar status in a terminal.', { class: 'error' }))
    box.appendChild(h('div', { class: 'row' }, button('Check again', { class: 'btn', 'data-action': 'refresh' }, 'refresh', () => a.refresh())))
  } else if (!m) {
    if (v.focus === 'none') {
      root.appendChild(
        empty(false, 'No craftar workspace has the focus', 'A workspace follows a Forge once it holds craftar.yaml — start one in a terminal with craftar init.'),
      )
    } else root.appendChild(t('p', 'Reading…', { class: 'muted' }))
  }

  if (m) drawModel(m)

  if (diff) {
    const body = h('div', { class: 'diff' })
    if ('refused' in diff) body.appendChild(t('p', diff.refused, { class: 'error' }))
    else {
      body.appendChild(t('pre', diff.text, { class: 'words' }))
      if ((diff.warnings ?? []).length > 0) {
        const ul = body.appendChild(h('ul', { class: 'lines' }))
        for (const w of diff.warnings ?? []) ul.appendChild(t('li', w, { class: 'warn', 'data-role': 'warning' }))
      }
    }
    root.appendChild(sec(diff.path, null, body, { 'data-role': 'diff' }))
  }

  if (v.probe) {
    // The probe's report, as the worker wrote it — its terminal lines included, which only this panel shows.
    root.appendChild(sec('Probe report', null, t('pre', v.probe.lines.join('\n'), { class: 'words', 'data-role': 'probe-text' }), { 'data-role': 'probe' }))
  }

  if (v.remote.length > 0) {
    const ul = h('ul', { class: 'links' })
    for (const r of v.remote) {
      const li = ul.appendChild(h('li'))
      li.appendChild(h('span', { class: 'd mute' }))
      li.appendChild(h('span', {}, t('span', r.name, { class: 'nm' }), t('span', `${r.path} (on another host — not read)`, { class: 'pt' })))
    }
    root.appendChild(sec('On another host', v.remote.length, ul))
  }

  const footer = root.appendChild(h('footer'))
  footer.appendChild(t('span', footLeft()))
  footer.appendChild(h('span', { class: 'sep' }))
  if (version) footer.appendChild(t('span', `craftar ${version}`))

  // ---- pieces ----

  function statePill(): [string, string] | null {
    if (v.focus === 'ask') return null
    if (broken) return ['bad', 'no craftar']
    if (v.readFailed) return ['bad', 'error']
    if (!m) return null
    if (m.refused) return ['bad', 'sync refused']
    if (m.checkFailed) return ['bad', 'check failed']
    if (cached) return ['warn', 'cached copy']
    const down = m.pending.length
    if (down > 0 && m.edited.length > 0) return ['em', `${down} ↓ · ${promotable > 0 ? `${promotable} ↑` : `${m.edited.length} edited`}`]
    if (down > 0) return ['em', `${down} pending`]
    if (promotable > 0) return ['st', `${promotable} to send up`]
    if (m.edited.length > 0) return ['st', `${m.edited.length} edited`]
    if (m.apart.length > 0) return ['warn', `${m.apart.length} apart`]
    return ['ok', 'in sync']
  }

  function footLeft(): string {
    if (broken) return 'craftar: not usable'
    if (!m) return v.focus === 'ask' ? 'not read yet' : v.focus === 'none' ? 'no craftar.yaml in focus' : ''
    const f = m.forge
    const when = f?.fetchedAt ? new Date(f.fetchedAt).toLocaleString() : null
    if (f?.freshness === 'fetched') return `fetched ${when ?? ''}`.trim()
    if (f?.freshness === 'cached') return `cached copy${when ? ` (last fetched ${when})` : ''}`
    return 'Forge on this machine'
  }

  function empty(bad: boolean, title: string, text: string): HTMLElement {
    const box = h('div', { class: 'empty' })
    const art = box.appendChild(s('svg', { class: 'art', viewBox: '0 0 140 64', 'aria-hidden': 'true', focusable: 'false' }))
    art.appendChild(s('rect', { x: '2', y: '14', width: '44', height: '36', rx: '6', class: bad ? 'art-box' : 'art-box forge' }))
    art.appendChild(s('rect', { x: '94', y: '14', width: '44', height: '36', rx: '6', class: 'art-box ws' }))
    art.appendChild(s('path', { d: 'M48 32 H92', class: bad ? 'art-link bad' : 'art-link' }))
    for (const [x, y, w, o] of [['10', '24', '28', '5'], ['10', '32', '18', '3'], ['102', '24', '28', '5'], ['102', '32', '18', '3']]) {
      art.appendChild(s('rect', { x, y, width: w, height: '4', rx: '2', class: `art-bar o${o}` }))
    }
    box.appendChild(t('h2', title))
    box.appendChild(t('p', text))
    box.appendChild(h('div', { class: 'row' }, button('Check again', { class: bad ? 'btn primary' : 'btn', 'data-action': 'refresh' }, 'refresh', () => a.refresh())))
    return box
  }

  function drawAsk(): void {
    const box = root.appendChild(h('section', { class: 'cta plain ask' }))
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

  function drawModel(m: PanelModel): void {
    const f = m.forge
    const down = m.pending.length
    const blocked = m.edited.length - promotable
    const linkBroken = m.refused || m.checkFailed || cached

    // ---- the tree ----
    const tree = root.appendChild(h('div', { class: 'tree', role: 'group', 'aria-label': 'Forge and workspace' }))
    const forge = tree.appendChild(h('div', { class: 'node forge' }))
    const kind = forge.appendChild(h('div', { class: 'kind' }))
    kind.appendChild(t('span', 'Forge'))
    if (cached) kind.appendChild(t('span', 'cached', { class: 'pill warn' }))
    const source = f?.source ?? null
    const fname = source ? (source.replace(/[\\/]+$/, '').split(/[\\/:]/).pop() ?? source).replace(/\.git$/, '') : '(not shown)'
    forge.appendChild(t('div', fname || source || '(not shown)', { class: 'name', ...(source ? { title: source } : {}) }))
    const fmeta = forge.appendChild(h('div', { class: 'meta' }))
    if (source) fmeta.appendChild(t('span', source))
    fmeta.appendChild(metaPair(f?.ref ? 'ref' : '', f?.ref ?? 'default branch'))
    fmeta.appendChild(metaPair('@', short(f?.commit ?? null) ?? 'no commit'))
    fmeta.appendChild(metaPair('profile', f?.profile ?? 'unknown'))

    tree.appendChild(link())

    const ws = tree.appendChild(h('div', { class: 'node ws' }))
    ws.appendChild(t('div', 'Workspace', { class: 'kind' }))
    ws.appendChild(t('div', m.name, { class: 'name' }))
    ws.appendChild(h('div', { class: 'meta' }, t('span', m.ws)))

    const branches = tree.appendChild(h('ul', { class: 'branches', 'aria-label': 'What the workspace receives' }))
    for (const o of m.outputs) {
      const c = o.counts
      const n = Object.values(c).reduce((x, y) => x + y, 0)
      const add = c.new ?? 0
      const upd = (c.update ?? 0) + (c.adopt ?? 0)
      const del = c.orphan ?? 0
      const edit = c.drift ?? 0
      const apart = (c.collision ?? 0) + (c['orphan-drift'] ?? 0)
      const dot = add + upd + del > 0 ? 'em' : edit > 0 ? 'st' : apart > 0 ? 'warn' : 'ok'
      const chip = branches.appendChild(h('li')).appendChild(h('div', { class: linkBroken ? 'chip dim' : 'chip' }))
      chip.appendChild(h('span', { class: `d ${dot}` }))
      // craftar counts files per owner, and an owner can write in several places (claude-code also writes
      // .mcp.json): the chip names the owner as craftar does, never a folder the panel would pick.
      chip.appendChild(t('span', o.owner, { class: 'dir' }))
      const em = [add > 0 ? `+${add}` : '', upd > 0 ? `~${upd}` : '', del > 0 ? `−${del}` : ''].filter(Boolean).join(' ')
      if (em) chip.appendChild(t('span', em, { class: 'delta em' }))
      if (edit > 0) chip.appendChild(t('span', `✎${edit}`, { class: 'delta st' }))
      if (apart > 0) chip.appendChild(t('span', `!${apart}`, { class: 'delta warn' }))
      chip.appendChild(t('span', plural(n, 'file', 'files'), { class: 'count' }))
    }

    // ---- what craftar refuses, and the cards that ask ----
    if (m.refused) {
      const box = root.appendChild(h('section', { class: 'cta bad', 'data-role': 'refused' }))
      box.appendChild(t('h2', 'craftar will not sync this workspace'))
      box.appendChild(t('pre', refusalLines(m.unset).join('\n'), { class: 'words' }))
    } else if (m.checkFailed) {
      const box = root.appendChild(h('section', { class: 'cta bad', 'data-role': 'check-failed' }))
      box.appendChild(t('h2', 'A check fails'))
      box.appendChild(t('p', "craftar status exits 1 — a check fails; craftar's lines below say why."))
    } else if (cached) {
      const box = root.appendChild(h('section', { class: 'cta bad', 'data-role': 'fetch-failed' }))
      box.appendChild(t('h2', 'The Forge could not be reached'))
      const when = f?.fetchedAt ? new Date(f.fetchedAt).toLocaleString() : null
      box.appendChild(t('p', `What you see comes from the cached copy${when ? ` fetched ${when}` : ''}. Updating waits for a fetch that works; craftar's words are below.`))
      box.appendChild(h('div', { class: 'row' }, button('Try again', { class: 'btn', 'data-action': 'refresh' }, 'refresh', () => a.refresh())))
    }

    if (v.consent) drawConsent(v.consent)
    // craftar's words about the last run; a consent refusal is said once, in the consent card above.
    if (v.sync?.message && !(v.sync.phase === 'consent' && v.consent)) {
      // An error is said as one.
      const err = v.sync.phase === 'error'
      const box = root.appendChild(h('section', { class: err ? 'cta bad' : 'cta plain', 'data-role': err ? 'sync-error' : 'sync-note' }))
      if (err) box.appendChild(t('h2', 'The update did not finish'))
      box.appendChild(t('pre', v.sync.message, { class: 'words', 'data-role': 'sync-message' }))
    }
    if (down > 0 && !m.refused && !m.checkFailed) drawUpdateCard(m)
    if (m.edited.length > 0 && !m.refused && !m.checkFailed) drawSendCard(m)
    if (v.lastSync) drawLastSync(v.lastSync)

    // O7: files saved since the last read that craftar lists — a hint until drift show reads them.
    if (v.marked && v.marked.length > 0) {
      const box = root.appendChild(h('section', { class: 'cta plain', 'data-role': 'marked-box' }))
      const ul = box.appendChild(h('ul', { class: 'lines plain' }))
      for (const p of v.marked) ul.appendChild(t('li', `${p} — edited, not yet in the Forge`, { 'data-role': 'marked' }))
    }

    // ---- flat lists ----
    fileList('Coming down', m.pending, (row) => t('span', row.state, { class: 'st' }))
    fileList('Edited here', m.edited, (row) =>
      row.promotable
        ? typeof a.sendPreview === 'function' && !(v.forgeDir?.needed && !v.forgeDir.dir) && v.send?.phase !== 'writing' && v.send?.phase !== 'checking'
          ? button('Send', { class: 'btn steel act', 'data-action': 'send-file', 'data-path': row.path }, 'up', () => a.sendPreview?.(row.path))
          : button('Send', { class: 'btn steel act', 'data-action': 'send-file', 'data-path': row.path, disabled: '', title: typeof a.sendPreview !== 'function' ? NOT_BUILT_SEND : v.forgeDir?.needed && !v.forgeDir.dir ? 'name a local clone of the Forge first' : 'craftar is working on a send' }, 'up', null)
        : row.reason
          ? t('span', row.reason, { class: 'why' })
          : t('span', row.state, { class: 'st' }),
    )
    fileList('Kept apart', m.apart, (row) => t('span', row.state, { class: 'st' }))

    // ---- linked ----
    if (m.repos.length > 0 || m.siblings.length > 0) {
      const ul = h('ul', { class: 'links' })
      for (const r of m.repos) linkRow(ul, r.name, `repository · ${r.path}${r.reason ? ` (${r.reason})` : ''}`, r.state, r.state === 'present')
      for (const w of m.siblings) linkRow(ul, w.name, `workspace · ${w.path}${w.forgeMoved ? ' · forge moved' : ''}`, w.status, w.status === 'up to date')
      root.appendChild(sec('Linked', m.repos.length + m.siblings.length, ul))
    }

    // ---- craftar says ----
    if (m.warnings.length > 0 || m.errors.length > 0) {
      const open = m.refused || m.checkFailed || cached || m.errors.length > 0
      const det = root.appendChild(h('details', { class: 'says', ...(open ? { open: '' } : {}) }))
      const sum = det.appendChild(h('summary'))
      sum.appendChild(t('span', 'craftar says'))
      sum.appendChild(t('span', String(m.warnings.length + m.errors.length), { class: 'pill warn' }))
      const ul = det.appendChild(h('ul'))
      for (const w of m.warnings) ul.appendChild(t('li', w, { 'data-role': 'warning' }))
      for (const e of m.errors) ul.appendChild(t('li', e, { 'data-role': 'error', class: 'err error' }))
    }

    function link(): HTMLElement {
      const idle = !linkBroken && down === 0 && m.edited.length === 0 && m.apart.length === 0
      const laneCls = (on: boolean, dir: string): string => `lane ${dir}${linkBroken ? ' broken' : on ? ' on' : idle ? ' idle' : ''}`
      const svg = s('svg', { viewBox: '0 0 52 64', preserveAspectRatio: 'none', 'aria-hidden': 'true', focusable: 'false' })
      svg.appendChild(s('path', { d: 'M18 0 V64', class: laneCls(down > 0, 'down') }))
      svg.appendChild(s('path', { d: 'M34 64 V0', class: laneCls(promotable > 0, 'up') }))
      if (!linkBroken && down > 0) {
        svg.appendChild(s('path', { d: 'M13.5 57 L18 62 L22.5 57', class: 'head e' }))
        svg.appendChild(s('path', { d: 'M18 0 V64', class: 'comet e' }))
      }
      if (!linkBroken && promotable > 0) {
        svg.appendChild(s('path', { d: 'M29.5 7 L34 2 L38.5 7', class: 'head s' }))
        svg.appendChild(s('path', { d: 'M34 64 V0', class: 'comet s' }))
      }
      if (idle) svg.appendChild(s('circle', { cx: '26', cy: '32', r: '3.2', class: 'dot-pulse' }))
      const label = h('div', { class: 'link-label' })
      const flow = (c: string, ar: string, text: Kid, note: string | null): void => {
        const row = label.appendChild(h('div', { class: `flow ${c}` }))
        row.appendChild(t('span', ar, { class: 'ar' }))
        const tt = row.appendChild(h('span', { class: 't' }))
        if (text) tt.appendChild(typeof text === 'string' ? t('span', text) : text)
        if (note) row.appendChild(t('small', note))
      }
      if (linkBroken) {
        const what = m.refused ? 'sync refused' : m.checkFailed ? 'check failed' : 'could not fetch the Forge'
        const note = cached ? 'showing the cached copy' : "craftar says why below"
        flow('bad', '✕', what, note)
      } else if (idle) {
        flow('ok', '=', 'in sync', 'nothing to bring down, nothing to send up')
      } else {
        const lock = short(f?.lockCommit ?? null)
        const now = short(f?.commit ?? null)
        if (down > 0) flow('e', '↓', counted(down, ' coming down from the Forge'), lock && now && lock !== now ? `commit ${lock} → ${now}` : null)
        else flow('off', '↓', 'nothing coming down', null)
        if (promotable > 0) {
          flow('s', '↑', counted(promotable, ' can go up to the Forge'), blocked > 0 ? `${blocked} more edited here that craftar will not send — see why below` : 'edited here by hand · kept on every sync')
        } else flow('off', '↑', 'nothing to send up', blocked > 0 ? `${blocked} edited here that craftar will not send — see why below` : null)
      }
      return h('div', { class: 'link' }, svg, label)
    }
  }

  function counted(n: number, rest: string): HTMLElement {
    const span = h('span')
    span.appendChild(t('strong', String(n)))
    span.appendChild(t('span', rest))
    return span
  }

  function metaPair(k: string, val: string): HTMLElement {
    const span = h('span')
    if (k) span.appendChild(t('span', `${k} `))
    span.appendChild(t('strong', val))
    return span
  }

  function linkRow(ul: HTMLElement, name: string, pt: string, state: string, ok: boolean): void {
    const li = ul.appendChild(h('li'))
    li.appendChild(h('span', { class: `d ${ok ? 'ok' : 'mute'}` }))
    li.appendChild(h('span', {}, t('span', name, { class: 'nm' }), t('span', pt, { class: 'pt' })))
    li.appendChild(t('span', state, { class: ok ? 'pill ok' : 'pill' }))
  }

  function drawUpdateCard(m: PanelModel): void {
    const u = v.update
    const files = u ? u.files.map((x) => x.path) : m.pending.map((x) => x.path)
    // The card counts exactly what the confirm will list and run with.
    const n = files.length
    const running = v.sync?.phase === 'running'
    // A cached copy keeps Update disabled whatever the worker says (O10): the panel enforces it too.
    const allowed = u ? u.allowed && n > 0 && !running && !cached && typeof a.updateRun === 'function' : false
    const reason = cached
      ? (u?.reason ?? 'needs a fetch that works')
      : u
        ? (u.reason ??
          (running ? 'craftar is updating this workspace' : n === 0 ? 'the plugin has no file to update yet — check again' : typeof a.updateRun !== 'function' ? NOT_BUILT_UPDATE : null))
        : NOT_BUILT_UPDATE
    const card = root.appendChild(h('section', { class: 'cta', 'data-role': 'update-card' }))
    card.appendChild(t('h2', `Update ${plural(n, 'file', 'files')} and add ${n === 1 ? 'it' : 'them'} to your commit?`))
    const kept = m.edited.length + m.apart.length
    card.appendChild(
      t(
        'p',
        `craftar syncs ${n === 1 ? 'it' : 'them'} from the Forge and stages exactly those paths and craftar.lock.${kept > 0 ? ` Your ${plural(kept, 'edited file is', 'edited files are')} kept as ${kept === 1 ? 'it is' : 'they are'} — the update never overwrites ${kept === 1 ? 'it' : 'them'}.` : ' Files you edited by hand are kept.'}`,
      ),
    )
    const row = card.appendChild(h('div', { class: 'row' }))
    const attrs: Record<string, string> = { class: 'btn primary', 'data-action': 'update' }
    if (!allowed) attrs.disabled = ''
    if (running) attrs['aria-busy'] = 'true'
    if (!allowed && reason) attrs.title = reason
    const confirmBox = h('div', { class: 'confirm', 'data-role': 'update-confirm-box' })
    row.appendChild(
      button(running ? 'Updating…' : 'Update and stage', attrs, 'down', () => {
        if (!allowed) return
        drawConfirm(confirmBox, files)
      }),
    )
    const first = m.pending[0]
    row.appendChild(button('Review changes', { class: 'btn', 'data-action': 'review-down' }, 'diff', first ? () => a.showDiff(first.path) : null))
    if (!allowed && reason) card.appendChild(t('p', reason, { class: 'note', 'data-role': 'update-reason' }))
    card.appendChild(confirmBox)
  }

  function drawConfirm(box: HTMLElement, files: string[]): void {
    box.replaceChildren()
    box.appendChild(t('h2', `Update ${plural(files.length, 'file', 'files')} and add ${files.length === 1 ? 'it' : 'them'} to your commit?`))
    const ul = box.appendChild(h('ul', { class: 'lines plain' }))
    for (const f of files) ul.appendChild(t('li', f))
    const row = box.appendChild(h('div', { class: 'row' }))
    row.appendChild(
      button('Update and stage', { class: 'btn primary', 'data-action': 'update-confirm' }, 'down', () => {
        box.replaceChildren()
        a.updateRun?.(files)
      }),
    )
    row.appendChild(button('Cancel', { class: 'btn', 'data-action': 'update-cancel' }, null, () => box.replaceChildren()))
  }

  function drawSendCard(m: PanelModel): void {
    const n = promotable
    const card = root.appendChild(h('section', { class: 'cta st', 'data-role': 'send-card' }))
    if (n > 0) {
      card.appendChild(t('h2', `Send ${plural(n, 'edited file', 'edited files')} up to the Forge?`))
      const profile = m.forge?.profile
      card.appendChild(
        t('p', `You changed ${n === 1 ? 'a file' : 'files'} that come${n === 1 ? 's' : ''} from the Forge. Send the change up so every workspace${profile ? ` on profile ${profile}` : ''} gets it — or it stays only here, kept on every sync.`),
      )
    } else {
      card.appendChild(t('h2', `${plural(m.edited.length, 'file', 'files')} edited here`))
      card.appendChild(t('p', 'craftar will not send these up — each row below says why. They stay only here, kept on every sync.'))
    }
    const row = card.appendChild(h('div', { class: 'row' }))
    const target = m.edited.find((e) => e.promotable)
    const needsClone = v.forgeDir?.needed === true && !v.forgeDir.dir
    const built = typeof a.sendPreview === 'function'
    const busy = v.send?.phase === 'writing' || v.send?.phase === 'checking'
    const can = n > 0 && built && !needsClone && !busy && !!target
    const why = !built ? NOT_BUILT_SEND : needsClone ? 'name a local clone of the Forge below first' : busy ? 'craftar is writing the Forge' : null
    if (n > 0) {
      const attrs: Record<string, string> = { class: 'btn steel', 'data-action': 'send' }
      if (!can) {
        attrs.disabled = ''
        if (why) attrs.title = why
      }
      row.appendChild(button('Send to Forge', attrs, 'up', can && target ? () => a.sendPreview?.(target.path) : null))
    }
    const first = m.edited[0]
    row.appendChild(button('Review edits', { class: 'btn', 'data-action': 'review-up' }, 'diff', first ? () => a.showDiff(first.path) : null))
    if (n > 0 && why) card.appendChild(t('p', why, { class: 'note' }))
    if (needsClone && n > 0) drawForgeDir(card)
    else if (v.forgeDir?.needed && v.forgeDir.dir && n > 0) {
      card.appendChild(
        h(
          'div',
          { class: 'row', 'data-role': 'forge-dir-stored' },
          t('span', `Forge clone: ${v.forgeDir.dir}`, { class: 'muted' }),
          button('Change', { class: 'btn', 'data-action': 'forge-dir-change' }, null, () => a.forgeDirSet?.('')),
        ),
      )
    }
    if (v.send) drawSend(card, v.send)
  }

  function drawForgeDir(card: HTMLElement): void {
    const box = card.appendChild(h('div', { class: 'confirm', 'data-role': 'forge-dir' }))
    box.appendChild(t('p', 'This Forge is a git URL. Type the folder of a local clone of it — craftar writes the change there, never a commit; the plugin keeps only this path.'))
    const input = box.appendChild(h('input', { type: 'text', 'data-role': 'forge-dir-input', placeholder: '/path/to/a/clone/of/the/forge', 'aria-label': 'Folder of a local clone of the Forge' }))
    box.appendChild(h('div', { class: 'row' }, button('Use this folder', { class: 'btn', 'data-action': 'forge-dir-save' }, null, () => a.forgeDirSet?.((input as HTMLInputElement).value.trim()))))
  }

  function drawSend(card: HTMLElement, sd: NonNullable<S3View['send']>): void {
    const box = card.appendChild(h('div', { class: 'confirm', 'data-role': 'send-box' }))
    const plan = sd.phase === 'done' ? (sd.result ?? sd.plan) : sd.plan
    if (sd.phase === 'error') {
      box.appendChild(t('h2', `craftar did not send ${sd.path}`))
      if (sd.message) box.appendChild(t('pre', sd.message, { class: 'words', 'data-role': 'send-message' }))
      return
    }
    box.appendChild(t('h2', sd.phase === 'done' ? `Sent ${sd.path} to the Forge's working tree` : sd.phase === 'writing' ? `Writing ${sd.path} to the Forge…` : sd.phase === 'checking' ? `craftar is checking ${sd.path}…` : `Send ${sd.path} to the Forge?`))
    if (plan) {
      box.appendChild(t('p', `${plan.outcome} · ${plan.promoted}`, { class: 'muted', 'data-role': 'send-outcome' }))
      const lines = (title: string, items: string[], role: string): void => {
        if (items.length === 0) return
        box.appendChild(t('h4', title))
        const ul = box.appendChild(h('ul', { class: 'lines plain' }))
        for (const i of items) ul.appendChild(t('li', i, { 'data-role': role }))
      }
      lines(sd.phase === 'done' ? 'Written in the Forge' : 'craftar would write in the Forge', plan.written.map((w) => `${w.path} · ${w.action}`), 'send-written')
      const shown = (x: unknown): string => (typeof x === 'string' ? x : JSON.stringify(x))
      lines('Values', plan.params.map((p) => `${p.key}: ${shown(p.old)} → ${shown(p.value)}`), 'send-param')
      lines('Written as plain text in the variant', (plan.flattened ?? []).map(shown), 'send-flattened')
      lines('Depends on it', (plan.dependents ?? []).map((d) => (d && typeof d === 'object' && 'ref' in d ? String((d as { ref: unknown }).ref) : shown(d))), 'send-dependent')
      const counts = Object.entries(plan.nextSync?.counts ?? {}).map(([k, n]) => `${k} ${n}`)
      if (counts.length > 0) box.appendChild(t('p', `This workspace's next sync: ${counts.join(', ')}`, { class: 'muted', 'data-role': 'send-next-sync' }))
      lines('Sections', plan.sections.map((x) => `${x.key} · ${x.name}`), 'send-section')
      if (plan.impact.workspaces.length > 0) box.appendChild(t('p', `${plural(plan.impact.workspaces.length, 'other registered workspace', 'other registered workspaces')} will see this on their next sync.`, { class: 'muted' }))
      lines('craftar says', plan.warnings, 'warning')
    }
    if (sd.phase === 'preview') {
      box.appendChild(
        h(
          'div',
          { class: 'row' },
          button('Write to the Forge', { class: 'btn steel', 'data-action': 'send-confirm' }, 'up', () => a.sendRun?.(sd.path)),
          button('Cancel', { class: 'btn', 'data-action': 'send-cancel' }, null, () => a.sendCancel?.()),
        ),
      )
      box.appendChild(t('p', "craftar writes the Forge's working tree only — nothing is committed, pushed or opened as a PR.", { class: 'note' }))
    }
    if (sd.phase === 'done') box.appendChild(t('p', "The Forge's working tree changed; nothing was committed. Branch, commit, push and PR come in the next slice — until then, use git in the Forge.", { class: 'note' }))
  }

  function drawConsent(c: NonNullable<S2View['consent']>): void {
    const box = root.appendChild(h('section', { class: 'cta plain', 'data-role': 'consent' }))
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
    const body = h('div', { class: 'last' })
    body.appendChild(t('p', `${plural(l.written.length, 'file', 'files')} written, ${plural(l.removed.length, 'file', 'files')} removed, ${plural(l.staged.length, 'path', 'paths')} staged.`, { class: 'muted' }))
    const list = (title: string, items: { text: string; role: string; cls?: string }[]): void => {
      if (items.length === 0) return
      body.appendChild(t('h4', title))
      const ul = body.appendChild(h('ul', { class: 'lines plain' }))
      for (const i of items) ul.appendChild(t('li', i.text, { 'data-role': i.role, ...(i.cls ? { class: i.cls } : {}) }))
    }
    list('Written', l.written.map((x) => ({ text: x, role: 'written' })))
    list('Staged', l.staged.map((x) => ({ text: x, role: 'staged' })))
    list('Left out of the commit (ignored by git, or never tracked)', (l.leftOut ?? []).map((x) => ({ text: x, role: 'left-out' })))
    list('Removed', l.removed.map((x) => ({ text: `${x.path} · ${x.reason}`, role: 'removed' })))
    list('Kept', l.kept.map((x) => ({ text: `${x.path} · ${x.state}${x.reason ? ` · ${x.reason}` : ''}`, role: 'kept' })))
    list('Changed since the question', l.differences.map((x) => ({ text: x, role: 'difference', cls: 'warn' })))
    list('craftar says', l.warnings.map((x) => ({ text: x, role: 'warning', cls: 'warn' })))
    if (l.rerun) body.appendChild(t('p', 'craftar kept a file that changed while it was writing — run Update again.', { class: 'note', 'data-role': 'rerun' }))
    root.appendChild(sec('Last update', null, body, { 'data-role': 'last-sync' }))
  }

  function fileList<T extends { path: string; state: string }>(title: string, rows: T[], right: (row: T) => HTMLElement): void {
    if (rows.length === 0) return
    const ul = h('ul', { class: 'files' })
    for (const row of rows) {
      const li = ul.appendChild(h('li'))
      const i = row.path.lastIndexOf('/')
      const [dir, fn] = i < 0 ? ['', row.path] : [row.path.slice(0, i + 1), row.path.slice(i + 1)]
      const [c, mark] = STATE_ICON[row.state] ?? STATE_ICON.update
      const b = li.appendChild(h('button', { class: 'file', type: 'button', title: 'Show the diff', 'data-action': 'diff', 'data-path': row.path }))
      b.appendChild(t('span', mark, { class: `ic ${c}`, 'aria-hidden': 'true' }))
      b.appendChild(h('span', { class: 'name' }, t('span', fn, { class: 'fn' }), dir ? t('span', dir, { class: 'dir' }) : null))
      b.addEventListener('click', () => a.showDiff(row.path))
      li.appendChild(right(row))
    }
    root.appendChild(sec(title, rows.length, ul))
  }
}
