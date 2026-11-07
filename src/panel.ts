// The panel's frame (ui: html, Orca generates the page around this module): it asks the worker for its
// view, redraws on every `state.changed` the worker posts, and asks for a diff on a click. It runs
// nothing itself and reaches no network; the drawing is panel-view.ts, every value inserted as text.
import { type DiffShown, render } from './panel-view'
import type { View } from './worker'

declare const orca: {
  plugin: {
    request(name: string, input?: unknown, opts?: { timeoutMs?: number }): Promise<unknown>
    on(event: string, handler: (payload: unknown) => void): void
  }
}

const STYLE = `
:root { color-scheme: light dark; }
body { margin: 0; background: var(--orca-background); color: var(--orca-foreground); font: 13px/1.45 system-ui, sans-serif; }
main { padding: 12px; }
header { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
h1 { font-size: 15px; margin: 0; }
h2 { font-size: 12px; margin: 14px 0 6px; color: var(--orca-muted-foreground); text-transform: uppercase; letter-spacing: .04em; }
ul { list-style: none; margin: 0; padding: 0; }
li { padding: 2px 0; }
button { font: inherit; color: var(--orca-secondary-foreground, inherit); background: var(--orca-secondary, rgba(127, 127, 127, .16)); border: 1px solid var(--orca-border, rgba(127, 127, 127, .55)); border-radius: 6px; padding: 2px 8px; cursor: pointer; }
button:hover:not([disabled]) { border-color: var(--orca-primary, currentColor); }
.ask button { display: block; width: 100%; text-align: left; margin: 6px 0; padding: 6px 10px; }
.ask button[aria-busy='true'] { opacity: .6; cursor: progress; }
button[disabled] { opacity: .5; cursor: not-allowed; }
button.file { background: none; border: none; padding: 0; color: var(--orca-foreground); text-decoration: underline; text-align: left; }
.state, .reason, .muted, figcaption { color: var(--orca-muted-foreground); }
.error { color: var(--orca-destructive, #c0392b); }
.warn { color: var(--orca-warning, #b7791f); }
.check, .refused { background: var(--orca-card); color: var(--orca-card-foreground); border-radius: 8px; padding: 8px 10px; margin-top: 10px; }
figure { margin: 12px 0 0; }
svg { width: 100%; height: auto; }
svg text { fill: var(--orca-foreground); font-size: 10px; }
svg text.title { font-weight: 600; font-size: 11px; }
svg text.count { fill: var(--orca-muted-foreground); }
svg .box { fill: var(--orca-card); stroke: var(--orca-border, currentColor); }
svg .arrow { stroke: var(--orca-muted-foreground); stroke-width: 2; }
svg .arrow.on { stroke: var(--orca-primary); }
pre { white-space: pre-wrap; word-break: break-word; background: var(--orca-muted); padding: 8px; border-radius: 6px; margin: 4px 0; }
`

const style = document.createElement('style')
style.textContent = STYLE
document.head.appendChild(style)
const root = document.createElement('main')
document.body.appendChild(root)

let view: View | null = null
let diff: DiffShown = null

function draw(): void {
  if (!view) {
    root.textContent = 'Reading…'
    return
  }
  render(document, root, view, actions, diff)
}

const actions = {
  choose(id: string): void {
    // The worker reads the chosen workspace before it answers: the buttons stay drawn meanwhile, so they
    // are disabled at once and a second click sends nothing. A refusal redraws from the worker's view.
    for (const b of Array.from(root.querySelectorAll<HTMLButtonElement>('.ask button'))) {
      b.disabled = true
      if (b.dataset.id === id) b.setAttribute('aria-busy', 'true')
    }
    void orca.plugin
      .request('focus.choose', { id }, { timeoutMs: 120_000 })
      .then((v) => {
        view = v as View
        diff = null
        draw()
      })
      .catch(() =>
        orca.plugin
          .request('state.get')
          .then((v) => {
            view = v as View
            draw()
          })
          .catch(() => {
            // Nothing could be read back: give the choices back rather than leave them disabled.
            for (const b of Array.from(root.querySelectorAll<HTMLButtonElement>('.ask button'))) {
              b.disabled = false
              b.removeAttribute('aria-busy')
            }
          }),
      )
  },
  refresh(): void {
    void orca.plugin.request('state.refresh', undefined, { timeoutMs: 120_000 }).then((v) => {
      view = v as View
      draw()
    })
  },
  showDiff(path: string): void {
    void orca.plugin.request('diff.get', { path }, { timeoutMs: 60_000 }).then((r) => {
      const res = r as { refused?: string; files?: { path: string; diff: string | null; note: string | null }[]; warnings?: string[] }
      if (typeof res.refused === 'string') diff = { path, refused: res.refused }
      else {
        const file = res.files?.find((f) => f.path === path)
        diff = { path, text: file?.diff ?? file?.note ?? 'no differences', warnings: Array.isArray(res.warnings) ? res.warnings : [] }
      }
      draw()
    })
  },
}

orca.plugin.on('state.changed', (payload) => {
  const next = payload as View
  if (view?.model?.ws !== next.model?.ws) diff = null
  view = next
  draw()
})

draw()
void orca.plugin.request('state.get').then((v) => {
  view = v as View
  draw()
})
