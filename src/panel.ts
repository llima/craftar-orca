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
/* Orca sets the --orca-* variables and a light or dark class on <html> (its theme, live); the plugin adds only
   its two accents and three signal colours, one pair per theme. The layout the user approved on 2026-11-08:
   header, a scrolling body, the actions in a fixed footer toolbar. No gradient. */
html.dark { color-scheme: dark; --ember: #E9915A; --ember-soft: rgba(233, 145, 90, .14); --steel: #7FB4D6; --steel-soft: rgba(127, 180, 214, .14); --ok: #7BC48A; --warn: #E0B35A; --on-steel: #08131B; --on-ember: #1A0D05; --top-sq: #E7ECF1; }
html.light { color-scheme: light; --ember: #C8642C; --ember-soft: rgba(200, 100, 44, .10); --steel: #2F7DB0; --steel-soft: rgba(47, 125, 176, .10); --ok: #2E8B4A; --warn: #A87412; --on-steel: #FFFFFF; --on-ember: #FFFFFF; --top-sq: #3A3F48; }
:root { --mono: "JetBrains Mono", ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace; --body: "IBM Plex Sans", system-ui, "Segoe UI", "Helvetica Neue", Arial, sans-serif; --line: var(--orca-border, rgba(127, 127, 127, .35)); --r: var(--orca-radius, 8px); }
* { box-sizing: border-box; }
/* Item 2: the page itself paints nothing, so the sidebar Orca draws behind it shows through, as in its own tabs. */
html, body { background: transparent; height: 100%; }
body { margin: 0; color: var(--orca-foreground); font: 13px/1.45 var(--body); -webkit-font-smoothing: antialiased; overflow: hidden; }
button { font: inherit; cursor: pointer; }
button:focus-visible, input:focus-visible { outline: 2px solid var(--orca-ring, var(--steel)); outline-offset: 2px; }
.muted, .note { color: var(--orca-muted-foreground); }
.error { color: var(--orca-destructive); }
p { margin: 0; }

main.shell { height: 100vh; display: grid; grid-template-rows: auto minmax(0, 1fr) auto auto; position: relative; }
header { display: flex; align-items: center; gap: 8px; min-width: 0; padding: 10px 12px; border-bottom: 1px solid var(--line); }
svg.logo { width: 20px; height: 20px; flex: none; }
h1.title { margin: 0; display: flex; align-items: baseline; gap: 8px; min-width: 0; font-size: inherit; font-weight: inherit; }
.brand { font-family: var(--mono); font-weight: 800; letter-spacing: -.04em; font-size: 14px; }
.ws-name { font-family: var(--mono); font-size: 12px; color: var(--orca-muted-foreground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.spacer { flex: 1; }
.icon-btn { position: relative; width: 26px; height: 26px; flex: none; display: grid; place-items: center; border-radius: 6px; border: 1px solid var(--line); background: var(--orca-secondary); color: var(--orca-secondary-foreground); padding: 0; }
.icon-btn:hover { background: var(--orca-accent); }
.icon-btn.on, .icon-btn[aria-expanded='true'] { background: var(--orca-accent); border-color: var(--orca-ring, var(--steel)); }
.icon-btn svg { width: 14px; height: 14px; }
.badge { position: absolute; top: -5px; right: -5px; min-width: 15px; height: 15px; padding: 0 4px; border-radius: 8px; background: var(--warn); color: #1B1408; font: 700 9.5px/15px var(--mono); text-align: center; }
.bell.bad .badge { background: var(--orca-destructive); color: var(--orca-destructive-foreground, #fff); }

/* Item 8: craftar's messages, behind the bell. */
.pop { display: none; position: absolute; top: 44px; right: 10px; width: min(320px, calc(100% - 20px)); max-height: 60vh; overflow: auto; z-index: 3; background: var(--orca-popover, var(--orca-card, #262a31)); color: var(--orca-popover-foreground, var(--orca-foreground)); border: 1px solid var(--line); border-radius: 8px; box-shadow: 0 10px 30px rgba(0, 0, 0, .28); padding: 10px; }
.pop.open { display: grid; gap: 8px; }
.pop-h { display: flex; align-items: center; gap: 8px; font: 500 10px/1.2 var(--mono); letter-spacing: .12em; text-transform: uppercase; color: var(--orca-muted-foreground); }
.pop-h .n { margin-left: auto; }
ul.msgs { margin: 0; padding: 0; list-style: none; display: grid; gap: 7px; }
ul.msgs li { font: 11.5px/1.45 var(--mono); padding-left: 10px; border-left: 2px solid var(--warn); overflow-wrap: anywhere; }
ul.msgs li.err { border-left-color: var(--orca-destructive); }
ul.msgs li.info { border-left-color: var(--line); }
ul.msgs li { display: grid; gap: 3px; }
ul.msgs li .lvl { font: 600 9.5px/1.2 var(--mono); letter-spacing: .1em; text-transform: uppercase; color: var(--warn); }
ul.msgs li.err .lvl { color: var(--orca-destructive); }
ul.msgs li.info .lvl { color: var(--orca-muted-foreground); }
ul.msgs li .fix { color: var(--orca-muted-foreground); font-size: 11px; }
ul.msgs.cleared { opacity: .6; }
.pop-h .btn.clear { min-height: 0; padding: 2px 8px; font: 500 10.5px/1.4 var(--mono); letter-spacing: 0; text-transform: none; }
/* × on a card: a small ghost button at the top right of its title row. */
.card-h { display: flex; align-items: flex-start; gap: 8px; min-width: 0; }
.card-h h2 { flex: 1; min-width: 0; }
.x-btn { flex: none; width: 22px; height: 22px; display: grid; place-items: center; padding: 0; border: 1px solid transparent; border-radius: 5px; background: transparent; color: var(--orca-muted-foreground); }
.x-btn:hover { background: var(--orca-accent); color: var(--orca-foreground); }
.x-btn svg { width: 12px; height: 12px; }
.notice { display: flex; align-items: flex-start; gap: 8px; }
.notice p { flex: 1; min-width: 0; }
.icon-btn[aria-busy='true'] { cursor: progress; opacity: .7; }
.icon-btn[disabled] { cursor: not-allowed; }

.body { overflow: auto; padding: 12px; display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; align-content: start; }

/* Item 4: the site's diagram. */
.diagram { display: grid; justify-items: center; min-width: 0; }
.node { width: 100%; background: var(--orca-card); color: var(--orca-card-foreground); border: 1px solid var(--line); border-radius: var(--r); padding: 8px 11px; min-width: 0; }
.node.forge { border-color: color-mix(in srgb, var(--ember) 70%, var(--line)); }
.node .t { font-family: var(--mono); font-weight: 700; font-size: 13px; display: flex; align-items: center; gap: 8px; min-width: 0; }
.node .t .nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.node .fresh { font-weight: 400; font-size: 10.5px; color: var(--orca-muted-foreground); display: flex; align-items: center; gap: 6px; margin-top: 3px; min-width: 0; overflow-wrap: anywhere; }
.node .s { font-family: var(--mono); font-size: 11px; color: var(--orca-muted-foreground); margin-top: 2px; overflow-wrap: anywhere; }
.node .s.src { font-size: 10.5px; opacity: .85; }
.em { color: var(--ember); }
.stc { color: var(--steel); }
.stem { width: 1px; height: 12px; background: color-mix(in srgb, var(--ember) 70%, var(--line)); }
.stem.broken { background: var(--orca-destructive); }
.node.sync { width: 84%; }
.flows { display: grid; gap: 3px; margin-top: 4px; }
.flow { display: grid; grid-template-columns: 14px minmax(0, 1fr); gap: 0 6px; align-items: baseline; font-family: var(--mono); font-size: 11px; color: var(--orca-muted-foreground); }
.flow .ar { font-weight: 700; text-align: center; }
.flow .tx { overflow-wrap: anywhere; }
.flow .tx strong { font-weight: 700; }
.flow small { grid-column: 2; font-size: 10.5px; overflow-wrap: anywhere; }
.flow.e .ar, .flow.e .tx { color: var(--steel); }
.flow.s .ar, .flow.s .tx { color: var(--ember); }
.flow.ok .ar, .flow.ok .tx { color: var(--ok); }
.flow.bad .ar, .flow.bad .tx { color: var(--orca-destructive); }
.flow.off { opacity: .6; }
svg.fan { width: 100%; height: 20px; display: block; }
svg.fan path { fill: none; stroke: var(--steel); stroke-width: 1.2; opacity: .75; vector-effect: non-scaling-stroke; }
svg.fan.broken path { stroke: var(--orca-destructive); stroke-dasharray: 2 4; }
.surfaces { width: 100%; list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.surfaces.n1 { grid-template-columns: minmax(0, 1fr); }
.surfaces.n2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.surfaces.n3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.surfaces.dim { opacity: .55; }
.surface { background: var(--orca-card); color: var(--orca-card-foreground); border: 1px solid color-mix(in srgb, var(--steel) 55%, var(--line)); border-radius: var(--r); padding: 7px 8px; min-width: 0; }
.surface .t { font-family: var(--mono); font-weight: 700; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.surface .st { display: flex; align-items: center; gap: 5px; font-family: var(--mono); font-size: 10.5px; color: var(--orca-muted-foreground); margin-top: 3px; white-space: nowrap; }
.surface .f { font-family: var(--mono); font-size: 10px; color: var(--orca-muted-foreground); margin-top: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wsbar { width: 100%; margin-top: 8px; background: var(--orca-card); color: var(--orca-card-foreground); border: 1px solid var(--line); border-radius: var(--r); padding: 8px 11px; display: grid; gap: 2px; min-width: 0; }
.wsbar .t { font-family: var(--mono); font-weight: 700; font-size: 13px; display: flex; align-items: center; gap: 8px; min-width: 0; }
.wsbar .k { font-family: var(--mono); font-size: 11px; color: var(--orca-muted-foreground); overflow-wrap: anywhere; }
.wsbar .k .pf { font-weight: 600; color: var(--ember); }
.wsbar .k .lk { color: var(--steel); }
.wsbar .k.path { font-size: 10.5px; }
.dot { width: 7px; height: 7px; border-radius: 50%; display: inline-block; flex: none; }
.dot.ok { background: var(--ok); }
.dot.warn { background: var(--warn); }
.dot.bad { background: var(--orca-destructive); }

/* Cards: craftar's refusals and questions. Flat, no gradient. */
.cta, .card { border-radius: var(--r); border: 1px solid var(--line); background: var(--orca-card); color: var(--orca-card-foreground); padding: 10px 12px; display: grid; gap: 8px; min-width: 0; }
.cta.bad, .card.bad { border-color: color-mix(in srgb, var(--orca-destructive) 45%, var(--line)); }
.cta.warn { border-color: color-mix(in srgb, var(--warn) 45%, var(--line)); }
.card.up { border-color: color-mix(in srgb, var(--ember) 60%, var(--line)); }
.card.down { border-color: color-mix(in srgb, var(--steel) 60%, var(--line)); }
.cta h2, .card h2 { margin: 0; font: 600 13.5px/1.35 var(--body); overflow-wrap: anywhere; }
.cta p, .card p { color: var(--orca-muted-foreground); font-size: 12.5px; overflow-wrap: anywhere; }
.cta .note { font-size: 11.5px; }
p.note.bad { color: var(--orca-destructive); font-size: 12px; }
.row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.row.clone { justify-content: space-between; font-size: 12px; }
.row.clone .muted { overflow-wrap: anywhere; min-width: 0; }
input[type='text'] { width: 100%; font: 12px var(--mono); padding: 6px 8px; border-radius: 6px; border: 1px solid var(--orca-input, var(--line)); background: var(--orca-background); color: var(--orca-foreground); }
.kv { display: grid; grid-template-columns: 76px minmax(0, 1fr); gap: 3px 10px; margin: 0; font-family: var(--mono); font-size: 11.5px; }
.kv dt { color: var(--orca-muted-foreground); }
.kv dd { margin: 0; overflow-wrap: anywhere; }
.steps { display: flex; gap: 6px; font-family: var(--mono); font-size: 10.5px; color: var(--orca-muted-foreground); }
.steps span { padding: 2px 7px; border: 1px solid var(--line); border-radius: 10px; }
.steps span.on { color: var(--ember); border-color: color-mix(in srgb, var(--ember) 60%, var(--line)); }
.steps span.done { color: var(--ok); border-color: color-mix(in srgb, var(--ok) 50%, var(--line)); }
.ok-banner { display: flex; gap: 9px; align-items: flex-start; padding: 9px 11px; border-radius: var(--r); border: 1px solid color-mix(in srgb, var(--ok) 50%, var(--line)); background: color-mix(in srgb, var(--ok) 9%, var(--orca-card)); }
.ok-banner svg { width: 16px; height: 16px; color: var(--ok); flex: none; margin-top: 1px; }
.ok-banner .muted { font-size: 12px; overflow-wrap: anywhere; }

.btn { display: inline-flex; align-items: center; justify-content: center; gap: 7px; min-height: 30px; padding: 5px 12px; border-radius: 6px; border: 1px solid var(--line); background: var(--orca-secondary); color: var(--orca-secondary-foreground); font-size: 12.5px; font-weight: 500; white-space: nowrap; }
.btn:hover:not([disabled]) { background: var(--orca-accent); }
.btn.primary { background: var(--orca-primary); border-color: var(--orca-primary); color: var(--orca-primary-foreground); font-weight: 600; }
.btn.down { background: var(--steel); border-color: var(--steel); color: var(--on-steel); font-weight: 600; }
.btn.ember { background: var(--ember); border-color: var(--ember); color: var(--on-ember); font-weight: 600; }
.btn.down:hover:not([disabled]), .btn.ember:hover:not([disabled]), .btn.primary:hover:not([disabled]) { filter: brightness(1.07); }
.btn.ghost { background: transparent; }
.btn svg { width: 13px; height: 13px; flex: none; }
.btn[disabled] { opacity: .5; cursor: not-allowed; }
.btn[aria-busy='true'] { cursor: progress; }

.sec { min-width: 0; }
.sec h3 { margin: 0 0 6px; display: flex; align-items: center; gap: 8px; font: 600 10px/1.2 var(--mono); letter-spacing: .12em; text-transform: uppercase; color: var(--orca-muted-foreground); min-width: 0; }
.sec h3 > span:first-child { overflow-wrap: anywhere; min-width: 0; }
.sec[data-role='diff'] h3 > span:first-child { text-transform: none; letter-spacing: .02em; }
.sec h3 .n { color: var(--orca-foreground); }
.sec h3 .x-btn { margin-left: auto; }
.files .acts { display: inline-flex; align-items: center; gap: 6px; }
[data-role='forgepr-box'] input[type='text'] { margin-bottom: 4px; }
.sec h4 { margin: 8px 0 4px; font: 500 10.5px/1.2 var(--mono); letter-spacing: .1em; text-transform: uppercase; color: var(--orca-muted-foreground); }

/* Item 6: the files, both directions. */
.files { list-style: none; margin: 0; padding: 0; display: grid; gap: 5px; }
.files li { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; align-items: center; gap: 6px; padding-right: 9px; background: var(--orca-card); border: 1px solid var(--line); border-radius: 6px; }
.files li .row-diff { width: 22px; height: 22px; }
.files li .row-diff svg { width: 12px; height: 12px; }
.files li:hover { background: var(--orca-accent); }
.file { display: grid; grid-template-columns: 12px 16px minmax(0, 1fr); align-items: center; gap: 7px; width: 100%; min-width: 0; text-align: left; background: none; border: 0; color: inherit; padding: 6px 0 6px 9px; }
.arrow { font: 600 12px/1 var(--mono); text-align: center; }
.arrow.down { color: var(--steel); }
.arrow.up { color: var(--ember); }
.arrow.apart { color: var(--warn); }
.file .ic { width: 16px; height: 16px; border-radius: 4px; display: grid; place-items: center; font: 700 10.5px/1 var(--mono); }
.ic.new { color: var(--ok); background: color-mix(in srgb, var(--ok) 14%, transparent); }
.ic.upd { color: var(--steel); background: var(--steel-soft); }
.ic.del { color: var(--orca-destructive); background: color-mix(in srgb, var(--orca-destructive) 14%, transparent); }
.ic.edit { color: var(--ember); background: var(--ember-soft); }
.ic.apart { color: var(--warn); background: color-mix(in srgb, var(--warn) 14%, transparent); }
.file .name { min-width: 0; }
.file .fn { display: block; font-family: var(--mono); font-size: 12px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.file .dir { display: block; font-family: var(--mono); font-size: 10.5px; color: var(--orca-muted-foreground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.files .st { font-family: var(--mono); font-size: 10.5px; color: var(--orca-muted-foreground); }
.files .act { font-size: 11.5px; padding: 3px 8px; min-height: 0; }
.files .why { font-size: 10.5px; color: var(--orca-muted-foreground); max-width: 130px; text-align: right; overflow-wrap: anywhere; }
ul.lst { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
ul.lst li { display: flex; gap: 8px; font-family: var(--mono); font-size: 11.5px; min-width: 0; }
ul.lst li .x { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
ul.lst li .a { margin-left: auto; color: var(--orca-muted-foreground); flex: none; }
ul.lines, ol.lines { margin: 0; padding: 0; list-style: none; display: grid; gap: 5px; }
ul.lines li, ol.lines li { font: 11px/1.45 var(--mono); padding-left: 10px; border-left: 2px solid var(--warn); overflow-wrap: anywhere; }
ul.lines li.err { border-left-color: var(--orca-destructive); }
ul.lines li.quiet { border-left-color: var(--line); color: var(--orca-muted-foreground); }
ul.lines.plain li, ol.lines.plain li { border-left-color: var(--line); }
ol.lines.plain { list-style: decimal inside; }
pre.words { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; min-width: 0; font: 11px/1.5 var(--mono); background: var(--orca-muted); color: var(--orca-foreground); border-radius: 6px; padding: 8px 9px; }

/* Item 5: the fixed footer toolbar, flat. */
footer.toolbar { border-top: 1px solid var(--line); background: var(--orca-card); padding: 9px 12px; display: grid; gap: 6px; min-width: 0; }
.tb { display: flex; gap: 8px; min-width: 0; }
.tb .btn { flex: 1 1 auto; min-width: 0; font-size: 12px; font-weight: 600; padding: 0 9px; gap: 6px; height: 32px; }
.tb .btn.ghost { flex: 0 0 auto; }
.tb .btn > span { overflow: hidden; text-overflow: ellipsis; }
.tb-empty { flex: 1; text-align: center; font: 11px var(--mono); color: var(--orca-muted-foreground); padding: 6px 0; }
.fnote { font: 10.5px/1.4 var(--mono); color: var(--orca-muted-foreground); text-align: center; overflow-wrap: anywhere; }
.fnote.left { text-align: left; }
/* A URL Forge's clone folder, asked for in the toolbar above the buttons. */
.tb-clone { display: grid; gap: 6px; min-width: 0; }
.tb-clone input[type='text'] { flex: 1 1 auto; min-width: 0; height: 32px; }
footer.toolbar .row.clone { display: flex; align-items: center; gap: 8px; }

/* Item 1: no craftar workspace — the logo animated, white on top, linked to orange and blue. */
.empty { display: grid; justify-items: center; align-content: center; text-align: center; gap: 12px; padding: 28px 14px; min-height: 100%; }
.empty svg.art { width: 150px; height: 120px; max-width: 100%; overflow: visible; }
.empty h2 { margin: 0; font: 600 15px/1.3 var(--body); }
.empty p { color: var(--orca-muted-foreground); font-size: 12.5px; max-width: 300px; overflow-wrap: anywhere; }
.empty .row { justify-content: center; }
.art-box { fill: var(--orca-card); stroke-width: 1.6; }
.art-box.w { stroke: var(--top-sq); }
.art-box.o { stroke: var(--ember); }
.art-box.b { stroke: var(--steel); }
.art.bad .art-box.o, .art.bad .art-box.b { stroke: var(--orca-destructive); }
.art-bar { fill: none; stroke-width: 3; stroke-linecap: round; opacity: .55; }
.art-bar.w { stroke: var(--top-sq); }
.art-bar.o { stroke: var(--ember); }
.art-bar.b { stroke: var(--steel); }
.art-link { fill: none; stroke-width: 1.4; stroke-dasharray: 3 4; animation: link-flow 1.6s linear infinite; }
.art-link.o { stroke: var(--ember); }
.art-link.b { stroke: var(--steel); }
.art.bad .art-link { stroke: var(--orca-destructive); animation: none; }
.art-top { animation: lift 2.4s ease-in-out infinite; }
@keyframes link-flow { to { stroke-dashoffset: -14; } }
@keyframes lift { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }

.choice { display: grid; gap: 6px; }
.choice .btn { justify-content: flex-start; text-align: left; padding: 8px 10px; min-height: 0; display: grid; grid-template-columns: 16px minmax(0, 1fr); }
.choice .btn > span { min-width: 0; }
.choice .btn .nm { display: block; font-family: var(--mono); font-weight: 600; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.choice .btn .pt { display: block; font-family: var(--mono); font-size: 10.5px; color: var(--orca-muted-foreground); font-weight: 400; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ask .btn[aria-busy='true'] { opacity: .6; cursor: progress; }

.status-line { display: flex; gap: 10px; align-items: center; padding: 7px 12px; border-top: 1px solid var(--line); font: 10.5px/1.3 var(--mono); color: var(--orca-muted-foreground); min-width: 0; }

/* the panel does not move when the person asked for less motion */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; }
}
`

const style = document.createElement('style')
style.textContent = STYLE
document.head.appendChild(style)
const root = document.createElement('main')
document.body.appendChild(root)

let view: PanelView | null = null
// The Forge clone box opened with Change, with its draft: kept across redraws until Cancel, a save or another workspace.
let forgeEdit: string | null = null
// S3b: what was typed in the PR's branch and title fields, kept across redraws until a step runs or another workspace.
let prDraft: { branch?: string; title?: string } | null = null
let diff: DiffShown = null
// The worker's refusal of the panel's last request, shown until the next request (nothing is dropped).
let notice: string | null = null

function draw(): void {
  if (!view) {
    root.textContent = 'Reading…'
    return
  }
  render(document, root, view, actions, diff, notice, forgeEdit, prDraft)
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
  sendPreview(path: string): void {
    notice = null
    call('send.preview', { path }, 200_000)
  },
  sendRun(path: string): void {
    notice = null
    call('send.run', { path }, 200_000)
  },
  sendCancel(): void {
    notice = null
    call('send.cancel', {}, 30_000)
  },
  discardOpen(path: string): void {
    notice = null
    call('discard.open', { path }, 120_000)
  },
  discardRun(path: string): void {
    notice = null
    call('discard.run', { path }, 120_000)
  },
  discardCancel(): void {
    notice = null
    call('discard.cancel', {}, 30_000)
  },
  forgePrPrepare(): void {
    notice = null
    call('forgepr.prepare', {}, 60_000)
  },
  forgePrStep(step: 'prepare' | 'commit' | 'push' | 'pr', branch?: string, title?: string): void {
    notice = null
    // The draft is dropped only once the worker took the step: a refusal keeps what was typed.
    void orca.plugin
      .request('forgepr.step', { step, branch, title }, { timeoutMs: 60_000 })
      .then((v) => {
        prDraft = null
        view = v as PanelView
        draw()
      })
      .catch((e) => refused(e))
  },
  forgePrCheck(): void {
    notice = null
    call('forgepr.check', {}, 30_000)
  },
  forgePrShow(open: boolean): void {
    notice = null
    call('forgepr.show', { open }, 30_000)
  },
  forgePrDrop(): void {
    notice = null
    prDraft = null
    call('forgepr.drop', {}, 30_000)
  },
  forgePrDraft(field: 'branch' | 'title', value: string): void {
    prDraft = { ...(prDraft ?? {}), [field]: value }
  },
  forgeDirEdit(draft: string | null): void {
    forgeEdit = draft
    draw()
  },
  forgeDirDraft(value: string): void {
    // The first box too (no folder stored yet): what is typed survives a redraw.
    forgeEdit = value
  },
  forgeDirSet(dir: string): void {
    notice = null
    // The draft is dropped only once the worker took the folder: a refusal keeps what was typed.
    void orca.plugin
      .request('forge.dir.set', { dir }, { timeoutMs: 30_000 })
      .then((v) => {
        forgeEdit = null
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
  dismiss(key: string): void {
    call('card.dismiss', { key }, 30_000)
  },
  messagesClear(): void {
    notice = null
    call('messages.clear', {}, 30_000)
  },
  validate(): void {
    notice = null
    call('validate.run', {}, 30_000)
  },
  clearNotice(): void {
    notice = null
    draw()
  },
  openFile(path: string): void {
    notice = null
    call('file.open', { path }, 30_000)
  },
  closeDiff(): void {
    diff = null
    draw()
  },
  showDiff(path: string): void {
    // The same row's diff button again closes it.
    if (diff && diff.path === path) {
      diff = null
      draw()
      return
    }
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

/** A panel request: the worker's view drawn on its answer, its refusal shown in its words. */
function call(name: string, input: unknown, timeoutMs: number): void {
  void orca.plugin
    .request(name, input, { timeoutMs })
    .then((v) => {
      view = v as PanelView
      draw()
    })
    .catch((e) => refused(e))
}

/** A request the worker refused: its words shown, then the worker's view read again. */
function refused(e: unknown): void {
  notice = e instanceof Error && e.message ? e.message : 'the plugin could not do that: check again'
  void orca.plugin
    .request('state.get')
    .then((v) => {
      view = v as PanelView
      draw()
    })
    .catch(() => draw())
}

// Esc closes the diff, when the panel has the keyboard.
document.addEventListener('keydown', (e) => {
  // An Esc typed in a field belongs to the field.
  if (e.key === 'Escape' && diff && !(e.target instanceof HTMLInputElement)) {
    diff = null
    draw()
  }
})

orca.plugin.on('state.changed', (payload) => {
  const next = payload as PanelView
  if (view?.model?.ws !== next.model?.ws) {
    diff = null
    forgeEdit = null
    prDraft = null
  }
  view = next
  draw()
})

draw()
void orca.plugin.request('state.get').then((v) => {
  view = v as PanelView
  draw()
})
