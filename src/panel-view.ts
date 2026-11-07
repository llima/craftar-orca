// The panel's drawing (spec 60 §6), as a function of the worker's view: the Forge → workspace figure in
// inline SVG, the files on each arrow, linked projects, craftar's warnings verbatim, a refused sync in
// craftar's words, the self-check on top when anything fails, and a tie to break. Every value is put in
// with textContent, never as markup. S1 has no write: "Update" and "Send to Forge" are drawn disabled.
import type { UnsetParam } from './craftar'
import type { PanelModel } from './model'
import type { View } from './worker'

const SVG = 'http://www.w3.org/2000/svg'

export interface Actions {
  choose(id: string): void
  refresh(): void
  showDiff(path: string): void
}

export type DiffShown = { path: string; text: string; warnings?: string[] } | { path: string; refused: string } | null

type Doc = Pick<Document, 'createElement' | 'createElementNS'>

// craftar's own words for a refused sync (craftar-cli src/core/sync.ts: unsetSummary, unsetRefusal).
export function refusalLines(unset: UnsetParam[]): string[] {
  return [
    `sync refused: declared parameter(s) with no value: ${unset.map((u) => u.key).join(', ')}`,
    ...unset.map((u) => `  ${u.key}  declared by ${u.declaredBy.join(', ')} · cited by ${u.citedBy.join(', ')}`),
    '  fix: set each under params in the profile, or under overrides.params in craftar.yaml',
  ]
}

export function render(doc: Doc, root: HTMLElement, v: View, a: Actions, diff: DiffShown = null): void {
  const h = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, attrs: Record<string, string> = {}): HTMLElementTagNameMap[K] => {
    const e = doc.createElement(tag)
    for (const [k, val] of Object.entries(attrs)) e.setAttribute(k, val)
    if (text !== undefined) e.textContent = text
    return e
  }
  const s = (tag: string, attrs: Record<string, string> = {}, text?: string): SVGElement => {
    const e = doc.createElementNS(SVG, tag) as SVGElement
    for (const [k, val] of Object.entries(attrs)) e.setAttribute(k, val)
    if (text !== undefined) e.textContent = text
    return e
  }
  root.replaceChildren()

  const header = root.appendChild(h('header'))
  const title = header.appendChild(h('div', undefined, { class: 'title' }))
  // The logo's three squares on its dark tile (assets/icon.svg, variant A2), drawn inline: Orca takes only
  // named icons for the panel tab and the status bar item. Decorative: the title says "craftar".
  const logo = title.appendChild(s('svg', { viewBox: '0 0 64 64', class: 'logo', 'data-role': 'logo', 'aria-hidden': 'true', focusable: 'false' }))
  logo.appendChild(s('rect', { width: '64', height: '64', rx: '10', fill: '#0A0E13' }))
  logo.appendChild(s('rect', { x: '20.696', y: '7.124', width: '22.62', height: '22.62', rx: '3.393', fill: '#E7ECF1' }))
  logo.appendChild(s('rect', { x: '7.124', y: '34.268', width: '22.62', height: '22.62', rx: '3.393', fill: '#E9915A' }))
  logo.appendChild(s('rect', { x: '34.268', y: '34.268', width: '22.62', height: '22.62', rx: '3.393', fill: '#7FB4D6' }))
  title.appendChild(h('h1', v.model ? `craftar — ${v.model.name}` : 'craftar'))
  const refresh = header.appendChild(h('button', 'Refresh', { 'data-action': 'refresh', type: 'button' }))
  refresh.addEventListener('click', () => a.refresh())

  if (v.selfCheck.some((l) => l.level !== 'ok')) {
    const box = root.appendChild(h('section', undefined, { class: 'check' }))
    box.appendChild(h('h2', 'Self-check'))
    const ul = box.appendChild(h('ul'))
    for (const l of v.selfCheck.filter((x) => x.level !== 'ok')) ul.appendChild(h('li', l.message, { class: l.level, 'data-role': 'check' }))
  }

  if (v.focus === 'ask') {
    const box = root.appendChild(h('section', undefined, { class: 'ask' }))
    box.appendChild(h('p', 'Several workspaces match the focused one. Which is it?'))
    for (const r of v.ask) {
      const b = box.appendChild(h('button', `${r.name} — ${r.path}`, { 'data-action': 'choose', 'data-id': r.id, type: 'button' }))
      b.addEventListener('click', () => a.choose(r.id))
    }
  } else if (v.readFailed) {
    root.appendChild(h('p', 'craftar status gave no document for this workspace — see the self-check, or run craftar status in a terminal.', { class: 'error' }))
  } else if (!v.model) {
    root.appendChild(h('p', v.focus === 'none' ? 'No craftar workspace has the focus.' : 'Reading…', { class: 'muted' }))
  }

  const m = v.model
  if (m && v.focus === 'one') drawModel(m)

  if (diff) {
    const box = root.appendChild(h('section', undefined, { class: 'diff' }))
    box.appendChild(h('h2', diff.path))
    if ('refused' in diff) box.appendChild(h('p', diff.refused, { class: 'error' }))
    else {
      box.appendChild(h('pre', diff.text))
      const ul = box.appendChild(h('ul'))
      for (const w of diff.warnings ?? []) ul.appendChild(h('li', w, { 'data-role': 'warning' }))
    }
  }

  if (v.probe) {
    // The probe's report, as the worker wrote it — its terminal lines included, which only this panel shows.
    const box = root.appendChild(h('section', undefined, { class: 'probe', 'data-role': 'probe' }))
    box.appendChild(h('h2', 'Probe report'))
    box.appendChild(h('pre', v.probe.lines.join('\n'), { 'data-role': 'probe-text' }))
  }

  if (v.remote.length > 0) {
    const box = root.appendChild(h('section'))
    box.appendChild(h('h2', 'On another host'))
    const ul = box.appendChild(h('ul'))
    for (const r of v.remote) ul.appendChild(h('li', `${r.name} — ${r.path} (on another host — not read)`))
  }

  function drawModel(m: PanelModel): void {
    const f = m.forge
    const fig = root.appendChild(h('figure'))
    const svg = fig.appendChild(s('svg', { viewBox: '0 0 360 150', role: 'img', 'aria-label': 'Forge and workspace' })) as SVGElement
    svg.appendChild(s('rect', { x: '4', y: '20', width: '130', height: '110', rx: '8', class: 'box' }))
    svg.appendChild(s('text', { x: '14', y: '40', class: 'title' }, 'Forge'))
    svg.appendChild(s('text', { x: '14', y: '60' }, f?.source ?? '(not shown)'))
    svg.appendChild(s('text', { x: '14', y: '78' }, f?.ref ? `ref ${f.ref}` : 'default branch'))
    svg.appendChild(s('text', { x: '14', y: '96' }, f?.commit ? f.commit.slice(0, 7) : 'no commit'))
    svg.appendChild(s('text', { x: '14', y: '114' }, f?.profile ? `profile ${f.profile}` : 'profile unknown'))
    svg.appendChild(s('rect', { x: '226', y: '20', width: '130', height: '110', rx: '8', class: 'box' }))
    svg.appendChild(s('text', { x: '236', y: '40', class: 'title' }, 'Workspace'))
    m.outputs.slice(0, 4).forEach((o, i) => {
      const n = Object.values(o.counts).reduce((x, y) => x + y, 0)
      svg.appendChild(s('text', { x: '236', y: String(60 + i * 18) }, `${o.owner} · ${n}`))
    })
    svg.appendChild(s('line', { x1: '140', y1: '60', x2: '218', y2: '60', class: m.pending.length > 0 ? 'arrow on' : 'arrow' }))
    svg.appendChild(s('text', { x: '150', y: '54', class: 'count' }, `${m.pending.length} pending`))
    svg.appendChild(s('line', { x1: '218', y1: '100', x2: '140', y2: '100', class: m.edited.length > 0 ? 'arrow back on' : 'arrow back' }))
    svg.appendChild(s('text', { x: '150', y: '94', class: 'count' }, `${m.edited.length} edited`))
    const when = f?.fetchedAt ? new Date(f.fetchedAt).toLocaleString() : null
    const fresh =
      f?.freshness === 'fetched'
        ? `fetched ${when ?? ''}`.trim()
        : f?.freshness === 'cached'
          ? `cached copy${when ? ` (last fetched ${when})` : ''}`
          : 'Forge on this machine'
    fig.appendChild(h('figcaption', fresh))

    if (m.checkFailed) {
      root.appendChild(h('p', "craftar status exits 1 — a check fails; craftar's lines below say why.", { class: 'refused' }))
    }
    if (m.refused) {
      const box = root.appendChild(h('section', undefined, { class: 'refused' }))
      for (const line of refusalLines(m.unset)) box.appendChild(h('pre', line))
    }

    const incoming = fileList('Coming from the Forge', m.pending, (row, li) => {
      li.appendChild(h('span', ` ${row.state}`, { class: 'state' }))
    })
    incoming?.appendChild(h('button', 'Update', { 'data-action': 'update', disabled: '', type: 'button', title: 'comes in the next slice' }))
    fileList('Edited by hand', m.edited, (row, li) => {
      if (row.promotable) li.appendChild(h('button', 'Send to Forge', { 'data-action': 'send', disabled: '', type: 'button', title: 'comes in a later slice' }))
      else if (row.reason) li.appendChild(h('span', ` ${row.reason}`, { class: 'reason' }))
    })
    fileList('Kept apart', m.apart, (row, li) => {
      li.appendChild(h('span', ` ${row.state}`, { class: 'state' }))
    })

    if (m.repos.length > 0 || m.siblings.length > 0) {
      const box = root.appendChild(h('section'))
      box.appendChild(h('h2', 'Linked projects'))
      const ul = box.appendChild(h('ul'))
      for (const r of m.repos) ul.appendChild(h('li', `${r.name} — ${r.path} · ${r.state}${r.reason ? ` (${r.reason})` : ''}`))
      for (const w of m.siblings) ul.appendChild(h('li', `${w.name} — ${w.path} · ${w.status}${w.forgeMoved ? ' · forge moved' : ''}`))
    }

    if (m.warnings.length > 0 || m.errors.length > 0) {
      const box = root.appendChild(h('section', undefined, { class: 'warnings' }))
      box.appendChild(h('h2', 'craftar says'))
      const ul = box.appendChild(h('ul'))
      for (const w of m.warnings) ul.appendChild(h('li', w, { 'data-role': 'warning' }))
      for (const e of m.errors) ul.appendChild(h('li', e, { 'data-role': 'error', class: 'error' }))
    }
  }

  function fileList<T extends { path: string }>(title: string, rows: T[], extra: (row: T, li: HTMLElement) => void): HTMLElement | null {
    if (rows.length === 0) return null
    const box = root.appendChild(h('section'))
    box.appendChild(h('h2', `${title} · ${rows.length}`))
    const ul = box.appendChild(h('ul'))
    for (const row of rows) {
      const li = ul.appendChild(h('li'))
      const link = li.appendChild(h('button', row.path, { 'data-action': 'diff', 'data-path': row.path, type: 'button', class: 'file' }))
      link.addEventListener('click', () => a.showDiff(row.path))
      extra(row, li)
    }
    return box
  }
}
