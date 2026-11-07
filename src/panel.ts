// The panel's frame (ui: html, Orca generates the page around this module): it asks the worker for its
// view, redraws on every `state.changed` the worker posts, and asks for a diff on a click. It runs
// nothing itself and reaches no network; the drawing is panel-view.ts, every value inserted as text.
import { type DiffShown, type PanelView, render } from './panel-view'

declare const orca: {
  plugin: {
    request(name: string, input?: unknown, opts?: { timeoutMs?: number }): Promise<unknown>
    on(event: string, handler: (payload: unknown) => void): void
  }
}

const STYLE = `
/* Orca sets the --orca-* variables and a light or dark class on <html>; the plugin adds only its two
   accents and three signal colours, one pair per theme (the approved design, agent 62, 2026-11-07). */
html.dark { --ember: #E9915A; --ember-soft: rgba(233, 145, 90, .14); --steel: #7FB4D6; --steel-soft: rgba(127, 180, 214, .14); --ok: #7BC48A; --warn: #E0B35A; --comet-e: #F3B183; --comet-s: #CFE6F7; --on-steel: #08131B; }
html.light { --ember: #C8642C; --ember-soft: rgba(200, 100, 44, .10); --steel: #2F7DB0; --steel-soft: rgba(47, 125, 176, .10); --ok: #2E8B4A; --warn: #A87412; --comet-e: #E9915A; --comet-s: #7FB4D6; --on-steel: #FFFFFF; }
:root { color-scheme: light dark; --mono: "JetBrains Mono", ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace; --body: "IBM Plex Sans", system-ui, "Segoe UI", "Helvetica Neue", Arial, sans-serif; --line: var(--orca-border, rgba(127, 127, 127, .35)); --r: var(--orca-radius, 8px); }
* { box-sizing: border-box; }
body { margin: 0; background: var(--orca-background); color: var(--orca-foreground); font: 13px/1.45 var(--body); -webkit-font-smoothing: antialiased; overflow-x: hidden; }
main { padding: 12px 12px 20px; display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; }
button { font: inherit; cursor: pointer; }
button:focus-visible, summary:focus-visible { outline: 2px solid var(--orca-ring, var(--steel)); outline-offset: 2px; }
.muted, .note { color: var(--orca-muted-foreground); }
.error { color: var(--orca-destructive); }
p { margin: 0; }

header { display: flex; align-items: center; gap: 8px; min-width: 0; }
svg.logo { width: 20px; height: 20px; flex: none; }
h1.title { margin: 0; display: flex; align-items: baseline; gap: 6px; min-width: 0; font-size: inherit; font-weight: inherit; }
.brand { font-family: var(--mono); font-weight: 800; letter-spacing: -.04em; font-size: 14px; }
.ws-name { font-family: var(--mono); font-size: 12px; color: var(--orca-muted-foreground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.spacer { flex: 1; }
.pill { font-family: var(--mono); font-size: 10px; letter-spacing: .08em; text-transform: uppercase; padding: 2px 7px; border-radius: 3px; border: 1px solid var(--line); color: var(--orca-muted-foreground); white-space: nowrap; }
.pill.ok { color: var(--ok); border-color: color-mix(in srgb, var(--ok) 45%, transparent); }
.pill.em { color: var(--ember); border-color: color-mix(in srgb, var(--ember) 45%, transparent); }
.pill.st { color: var(--steel); border-color: color-mix(in srgb, var(--steel) 45%, transparent); }
.pill.bad { color: var(--orca-destructive); border-color: color-mix(in srgb, var(--orca-destructive) 45%, transparent); }
.pill.warn { color: var(--warn); border-color: color-mix(in srgb, var(--warn) 45%, transparent); }
.icon-btn { width: 26px; height: 26px; flex: none; display: grid; place-items: center; border-radius: 6px; border: 1px solid var(--line); background: var(--orca-secondary); color: var(--orca-secondary-foreground); padding: 0; }
.icon-btn:hover { background: var(--orca-accent); }
.icon-btn svg { width: 14px; height: 14px; }

.tree { position: relative; min-width: 0; }
.node { position: relative; background: var(--orca-card); color: var(--orca-card-foreground); border: 1px solid var(--line); border-radius: var(--r); padding: 9px 11px 9px 12px; overflow: hidden; }
.node::before { content: ""; position: absolute; inset: 0 auto 0 0; width: 3px; }
.node.forge::before { background: var(--ember); }
.node.ws::before { background: var(--steel); }
.node .kind { font-family: var(--mono); font-size: 10px; letter-spacing: .12em; text-transform: uppercase; display: flex; align-items: center; gap: 8px; }
.node.forge .kind { color: var(--ember); }
.node.ws .kind { color: var(--steel); }
.node .kind .pill { margin-left: auto; }
.node .name { font-family: var(--mono); font-weight: 700; font-size: 13.5px; letter-spacing: -.02em; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.meta { display: flex; flex-wrap: wrap; gap: 4px 10px; margin-top: 4px; font-family: var(--mono); font-size: 11px; color: var(--orca-muted-foreground); min-width: 0; }
.meta > span { overflow-wrap: anywhere; min-width: 0; }
.meta strong { font-weight: 500; color: var(--orca-card-foreground); }

.link { display: grid; grid-template-columns: 52px minmax(0, 1fr); align-items: stretch; min-height: 64px; }
.link svg { width: 52px; height: 100%; min-height: 64px; overflow: visible; }
.lane { stroke: var(--line); stroke-width: 1.4; fill: none; }
.lane.down.on { stroke: color-mix(in srgb, var(--ember) 60%, var(--line)); }
.lane.up.on { stroke: color-mix(in srgb, var(--steel) 60%, var(--line)); }
.lane.idle { stroke: color-mix(in srgb, var(--ok) 45%, var(--line)); }
.lane.broken { stroke: var(--orca-destructive); stroke-dasharray: 2 4; }
.head { fill: none; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
.head.e { stroke: var(--ember); }
.head.s { stroke: var(--steel); }
.comet { fill: none; stroke-width: 2.6; stroke-linecap: round; stroke-dasharray: 10 74; }
.comet.e { stroke: var(--comet-e); animation: flow 1.8s linear infinite; }
.comet.s { stroke: var(--comet-s); animation: flow 2.2s linear infinite; }
@keyframes flow { from { stroke-dashoffset: 10; } to { stroke-dashoffset: -74; } }
.dot-pulse { fill: var(--ok); animation: pulse 2.8s ease-in-out infinite; transform-origin: center; transform-box: fill-box; }
@keyframes pulse { 0%, 100% { opacity: .35; transform: scale(.8); } 50% { opacity: 1; transform: scale(1.15); } }
.link-label { display: grid; align-content: center; gap: 4px; padding: 6px 0; min-width: 0; }
.flow { display: grid; grid-template-columns: 16px minmax(0, 1fr); gap: 0 6px; align-items: baseline; font-family: var(--mono); font-size: 11px; color: var(--orca-muted-foreground); }
.flow .ar { font-weight: 700; text-align: center; }
.flow .t { overflow-wrap: anywhere; }
.flow .t strong { font-weight: 700; }
.flow small { grid-column: 2; font-size: 10.5px; color: var(--orca-muted-foreground); overflow-wrap: anywhere; }
.flow.e .ar, .flow.e .t { color: var(--ember); }
.flow.s .ar, .flow.s .t { color: var(--steel); }
.flow.ok .ar, .flow.ok .t { color: var(--ok); }
.flow.bad .ar, .flow.bad .t { color: var(--orca-destructive); }
.flow.off { opacity: .55; }

.branches { list-style: none; margin: 0; padding: 0 0 0 22px; position: relative; }
.branches li { position: relative; padding: 5px 0 0 18px; }
.branches li::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; border-left: 1.4px solid var(--line); }
.branches li:last-child::before { bottom: auto; height: 17px; }
.branches li::after { content: ""; position: absolute; left: 0; top: 17px; width: 12px; border-top: 1.4px solid var(--line); }
.chip { display: flex; align-items: center; gap: 8px; padding: 4px 8px; border-radius: 6px; background: var(--orca-muted); font-family: var(--mono); font-size: 11.5px; min-width: 0; }
.chip .dir { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.chip .count { margin-left: auto; color: var(--orca-muted-foreground); white-space: nowrap; }
.chip .d { width: 6px; height: 6px; border-radius: 50%; flex: none; }
.chip.dim { opacity: .55; }
.d.ok { background: var(--ok); }
.d.em { background: var(--ember); }
.d.st { background: var(--steel); }
.d.warn { background: var(--warn); }
.d.bad { background: var(--orca-destructive); }
.d.mute { background: var(--orca-muted-foreground); }
.delta { font-size: 10.5px; padding: 0 5px; border-radius: 3px; white-space: nowrap; }
.delta.em { color: var(--ember); background: var(--ember-soft); }
.delta.st { color: var(--steel); background: var(--steel-soft); }
.delta.warn { color: var(--warn); background: color-mix(in srgb, var(--warn) 14%, transparent); }

.cta { border-radius: var(--r); border: 1px solid color-mix(in srgb, var(--ember) 40%, var(--line)); background: linear-gradient(180deg, var(--ember-soft), transparent 140%), var(--orca-card); color: var(--orca-card-foreground); padding: 11px 12px; display: grid; gap: 9px; min-width: 0; }
.cta.st { border-color: color-mix(in srgb, var(--steel) 40%, var(--line)); background: linear-gradient(180deg, var(--steel-soft), transparent 140%), var(--orca-card); }
.cta.bad { border-color: color-mix(in srgb, var(--orca-destructive) 45%, var(--line)); background: var(--orca-card); }
.cta.warn { border-color: color-mix(in srgb, var(--warn) 45%, var(--line)); background: var(--orca-card); }
.cta.plain { border-color: var(--line); background: var(--orca-card); }
.cta h2, .confirm h2 { margin: 0; font: 600 13.5px/1.35 var(--body); }
.cta p { color: var(--orca-muted-foreground); font-size: 12.5px; overflow-wrap: anywhere; }
.cta .note { font-size: 11.5px; }
.row { display: flex; gap: 8px; flex-wrap: wrap; }
.confirm:not(:empty) { display: grid; gap: 8px; padding-top: 9px; border-top: 1px solid var(--line); }
.btn { display: inline-flex; align-items: center; justify-content: center; gap: 7px; min-height: 30px; padding: 5px 12px; border-radius: 6px; border: 1px solid var(--line); background: var(--orca-secondary); color: var(--orca-secondary-foreground); font-weight: 500; font-size: 12.5px; transition: background .15s, border-color .15s, transform .1s; }
.btn:hover:not([disabled]) { background: var(--orca-accent); }
.btn:active:not([disabled]) { transform: translateY(1px); }
.btn.primary { background: var(--orca-primary); border-color: var(--orca-primary); color: var(--orca-primary-foreground); font-weight: 600; }
.btn.primary:hover:not([disabled]) { background: var(--orca-primary); filter: brightness(1.07); }
.btn.steel { background: var(--steel); border-color: var(--steel); color: var(--on-steel); font-weight: 600; }
.btn.steel:hover:not([disabled]) { background: var(--steel); filter: brightness(1.07); }
.btn svg { width: 14px; height: 14px; flex: none; }
.btn[disabled] { opacity: .5; cursor: not-allowed; }
.btn[aria-busy='true'] { cursor: progress; }

.sec { min-width: 0; }
.sec h3 { margin: 0 0 6px; display: flex; align-items: center; gap: 8px; font: 500 10.5px/1.2 var(--mono); letter-spacing: .1em; text-transform: uppercase; color: var(--orca-muted-foreground); min-width: 0; }
.sec h3 > span:first-child { overflow-wrap: anywhere; min-width: 0; }
.sec[data-role='diff'] h3 > span:first-child { text-transform: none; letter-spacing: .02em; }
.sec h3 .n { color: var(--orca-foreground); }
.sec h3 .line { flex: 1; min-width: 12px; height: 1px; background: var(--line); }
.sec h4 { margin: 8px 0 4px; font: 500 10.5px/1.2 var(--mono); letter-spacing: .1em; text-transform: uppercase; color: var(--orca-muted-foreground); }
.files { list-style: none; margin: 0; padding: 0; border: 1px solid var(--line); border-radius: var(--r); overflow: hidden; background: var(--orca-card); }
.files li { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 6px; padding-right: 10px; }
.files li + li { border-top: 1px solid var(--line); }
.files li:hover { background: var(--orca-accent); }
.file { display: grid; grid-template-columns: 18px minmax(0, 1fr); align-items: center; gap: 8px; width: 100%; min-width: 0; text-align: left; background: none; border: 0; color: inherit; padding: 7px 0 7px 10px; }
.file .ic { width: 18px; height: 18px; border-radius: 4px; display: grid; place-items: center; font: 700 11px/1 var(--mono); }
.ic.new { color: var(--ok); background: color-mix(in srgb, var(--ok) 14%, transparent); }
.ic.upd { color: var(--ember); background: var(--ember-soft); }
.ic.del { color: var(--orca-destructive); background: color-mix(in srgb, var(--orca-destructive) 14%, transparent); }
.ic.edit { color: var(--steel); background: var(--steel-soft); }
.ic.apart { color: var(--warn); background: color-mix(in srgb, var(--warn) 14%, transparent); }
.file .name { min-width: 0; }
.file .fn { display: block; font-family: var(--mono); font-size: 12px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.file .dir { display: block; font-family: var(--mono); font-size: 10.5px; color: var(--orca-muted-foreground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.files .st { font-family: var(--mono); font-size: 10.5px; color: var(--orca-muted-foreground); }
.files .act { font-size: 11.5px; padding: 3px 8px; min-height: 0; }
.files .why { font-size: 10.5px; color: var(--orca-muted-foreground); max-width: 130px; text-align: right; overflow-wrap: anywhere; }

.links { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
.links li { display: grid; grid-template-columns: 8px minmax(0, 1fr) auto; gap: 8px; align-items: center; padding: 5px 2px; font-size: 12px; }
.links li > span:nth-child(2) { min-width: 0; }
.links .nm { display: block; font-family: var(--mono); font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.links .pt { display: block; font-family: var(--mono); font-size: 10.5px; color: var(--orca-muted-foreground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.links .d { width: 7px; height: 7px; border-radius: 50%; }

details.says { border: 1px solid var(--line); border-radius: var(--r); background: var(--orca-card); color: var(--orca-card-foreground); }
details.says summary { cursor: pointer; list-style: none; padding: 7px 10px; display: flex; align-items: center; gap: 8px; font: 500 10.5px/1.2 var(--mono); letter-spacing: .1em; text-transform: uppercase; color: var(--orca-muted-foreground); }
details.says summary::-webkit-details-marker { display: none; }
details.says summary::after { content: "▸"; margin-left: auto; transition: transform .15s; }
details.says[open] summary::after { transform: rotate(90deg); }
details.says ul { margin: 0; padding: 0 10px 9px; list-style: none; display: grid; gap: 5px; }
details.says li, ul.lines li { font: 11px/1.45 var(--mono); padding-left: 10px; border-left: 2px solid var(--warn); overflow-wrap: anywhere; }
details.says li.err, ul.lines li.err { border-left-color: var(--orca-destructive); }
ul.lines, ol.lines { margin: 0; padding: 0; list-style: none; display: grid; gap: 5px; }
ul.lines.plain li, ol.lines.plain li { border-left-color: var(--line); }
ol.lines.plain { list-style: decimal inside; }
pre.words { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; min-width: 0; font: 11px/1.5 var(--mono); background: var(--orca-muted); color: var(--orca-foreground); border-radius: 6px; padding: 8px 9px; }

.empty { display: grid; justify-items: center; text-align: center; gap: 8px; padding: 22px 14px 18px; border: 1px dashed var(--line); border-radius: var(--r); }
.empty svg.art { width: 140px; height: 64px; max-width: 100%; }
.empty h2 { margin: 0; font: 600 14px/1.3 var(--body); }
.empty p { color: var(--orca-muted-foreground); font-size: 12.5px; max-width: 300px; overflow-wrap: anywhere; }
.empty .row { justify-content: center; }
.art-box { fill: var(--orca-card); stroke: var(--line); }
.art-box.forge { stroke: var(--ember); }
.art-box.ws { stroke: var(--steel); }
.art-link { fill: none; stroke: var(--line); stroke-width: 1.6; stroke-dasharray: 3 4; }
.art-link.bad { stroke: var(--orca-destructive); }
.art-bar { fill: var(--orca-muted-foreground); }
.art-bar.o5 { opacity: .5; }
.art-bar.o3 { opacity: .3; }

.choice { display: grid; gap: 6px; }
.choice .btn { justify-content: flex-start; text-align: left; padding: 8px 10px; min-height: 0; display: grid; grid-template-columns: 16px minmax(0, 1fr); }
.choice .btn > span { min-width: 0; }
.choice .btn .nm { display: block; font-family: var(--mono); font-weight: 600; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.choice .btn .pt { display: block; font-family: var(--mono); font-size: 10.5px; color: var(--orca-muted-foreground); font-weight: 400; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ask .btn[aria-busy='true'] { opacity: .6; cursor: progress; }

footer { display: flex; gap: 10px; align-items: center; font: 10.5px/1.3 var(--mono); color: var(--orca-muted-foreground); padding-top: 2px; min-width: 0; }
footer > span:first-child { overflow-wrap: anywhere; min-width: 0; }
footer .sep { flex: 1; }

/* the panel does not move when the person asked for less motion: lit lanes and arrowheads still say the direction */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; }
  .comet { display: none; }
}
`

const style = document.createElement('style')
style.textContent = STYLE
document.head.appendChild(style)
const root = document.createElement('main')
document.body.appendChild(root)

let view: PanelView | null = null
let diff: DiffShown = null
// The worker's refusal of the panel's last request, shown until the next request (nothing is dropped).
let notice: string | null = null

function draw(): void {
  if (!view) {
    root.textContent = 'Reading…'
    return
  }
  render(document, root, view, actions, diff, notice)
}

const actions = {
  choose(id: string): void {
    notice = null
    // The worker reads the chosen workspace before it answers: the buttons stay drawn meanwhile, so they
    // are disabled at once and a second click sends nothing. A refusal redraws from the worker's view.
    for (const b of Array.from(root.querySelectorAll<HTMLButtonElement>('.ask button'))) {
      b.disabled = true
      if (b.dataset.id === id) b.setAttribute('aria-busy', 'true')
    }
    void orca.plugin
      .request('focus.choose', { id }, { timeoutMs: 120_000 })
      .then((v) => {
        view = v as PanelView
        diff = null
        draw()
      })
      .catch(() =>
        orca.plugin
          .request('state.get')
          .then((v) => {
            view = v as PanelView
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
    notice = null
    void orca.plugin.request('state.refresh', undefined, { timeoutMs: 120_000 }).then((v) => {
      view = v as PanelView
      draw()
    })
  },
  updateRun(files: string[]): void {
    // S2: the worker checks the list is still the pending set, answers at once with the update running and
    // posts its progress on state.changed. A refusal is shown in its words, then the view is read again.
    notice = null
    void orca.plugin
      .request('update.run', { files }, { timeoutMs: 60_000 })
      .then((v) => {
        view = v as PanelView
        draw()
      })
      .catch((e) => refused(e))
  },
  consentTerminal(): void {
    notice = null
    void orca.plugin
      .request('consent.terminal', {}, { timeoutMs: 60_000 })
      .then((v) => {
        view = v as PanelView
        draw()
      })
      .catch((e) => refused(e))
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

/** A request the worker refused: its words shown, then the worker's view read again. */
function refused(e: unknown): void {
  notice = e instanceof Error && e.message ? e.message : 'the plugin could not do that — check again'
  void orca.plugin
    .request('state.get')
    .then((v) => {
      view = v as PanelView
      draw()
    })
    .catch(() => draw())
}

orca.plugin.on('state.changed', (payload) => {
  const next = payload as PanelView
  if (view?.model?.ws !== next.model?.ws) diff = null
  view = next
  draw()
})

draw()
void orca.plugin.request('state.get').then((v) => {
  view = v as PanelView
  draw()
})
