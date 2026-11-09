// The panel's drawing (spec 60 §6): every value as text, craftar's words verbatim, no action in S1.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { all, byAction, click, fakeDocument, type FakeEl } from '../test-support/fake-dom'
import { fixture } from '../test-support/stub-craftar'
import { buildModel } from './model'
import { render } from './panel-view'
import type { View } from './worker'

const WS = '/home/acme/web'

function modelView(over: Partial<View> = {}, warnings: string[] = []): View {
  const status = JSON.parse(fixture('status.json'))
  status.warnings = warnings
  const model = buildModel({
    ws: WS,
    name: 'web',
    status,
    drift: JSON.parse(fixture('drift-show.json')),
    repos: JSON.parse(fixture('repos.json')),
    registry: JSON.parse(fixture('workspaces.json')),
    fetchedAt: null,
    readAt: 0,
  })
  // The fields this file never draws are left out, as they always were; the cast lets the type check accept that.
  return { focus: 'one', selfCheck: [{ level: 'ok', message: 'craftar: /home/acme/bin/craftar' }], model, readFailed: false, ask: [], remote: [], probe: null, update: { allowed: false, reason: 'nothing to update', files: [] }, sync: { phase: 'idle', message: null }, consent: null, lastSync: null, ...over } as View
}

function draw(v: View, diff: Parameters<typeof render>[4] = null) {
  const doc = fakeDocument()
  const root = doc.createElement('main') as FakeEl
  const calls: string[] = []
  render(doc as never, root as never, v, { choose: (id) => calls.push(`choose ${id}`), refresh: () => calls.push('refresh'), showDiff: (p) => calls.push(`diff ${p}`) }, diff)
  return { root, calls }
}

test('the drawing: the Forge box, the workspace, the arrows with their counts, as SVG', () => {
  const { root } = draw(modelView())
  const text = root.textContent
  assert.match(text, /\.\.\/forge2/)
  assert.match(text, /d2309dc/)
  assert.match(text, /acme-web/)
  assert.match(text, /1 coming down from the Forge/)
  assert.match(text, /1 can go up to the Forge/)
  assert.ok(all(root).some((e) => e.tag === 'svg' && e.ns === 'http://www.w3.org/2000/svg'))
})

test('Update and Send to Forge are drawn disabled in S1; a file opens its diff on a click', () => {
  const { root, calls } = draw(modelView())
  const update = byAction(root, 'update')
  const send = byAction(root, 'send')
  assert.equal(update.length, 1)
  assert.equal(send.length, 1)
  assert.equal(update[0].getAttribute('disabled'), '')
  assert.equal(send[0].getAttribute('disabled'), '')
  const files = byAction(root, 'diff')
  assert.deepEqual(files.map((f) => f.attrs['data-path']), ['.claude/rules/workflow.md', '.claude/rules/commit-conventions.md'])
  click(files[0])
  assert.deepEqual(calls, ['diff .claude/rules/workflow.md'])
})

test('a file craftar will not promote shows its reason verbatim and no Send button', () => {
  const v = modelView()
  v.model!.edited = [{ path: '.kiro/steering/x.md', state: 'drift', promotable: false, reason: 'kiro file — edit its .claude/ twin' }]
  const { root } = draw(v)
  assert.match(root.textContent, /kiro file — edit its \.claude\/ twin/)
  assert.equal(byAction(root, 'send').length, 0)
})

test("warnings are listed as craftar words them, and a value holding markup stays text", () => {
  const hostile = '<img src=x onerror=alert(1)>'
  const { root } = draw(modelView({}, ['agents-md: the rule is long', hostile]))
  const items = all(root).filter((e) => e.attrs['data-role'] === 'warning').map((e) => e.textContent)
  assert.deepEqual(items, ['agents-md: the rule is long', hostile])
  assert.equal(all(root).some((e) => e.tag === 'img'), false)
})

test('a refused sync reads as craftar words it, with the keys and who declares them', () => {
  const v = modelView()
  v.model!.refused = true
  v.model!.unset = [{ key: 'acme.key', declaredBy: ['rule/a'], citedBy: ['rule/a'] }]
  const { root } = draw(v)
  assert.match(root.textContent, /sync refused/)
  assert.match(root.textContent, /acme\.key/)
})

test('the self-check is shown on top when anything fails; a tie lists the workspaces to pick from', () => {
  const failing = draw(modelView({ selfCheck: [{ level: 'error', message: 'craftar 0.30.0 is older than 0.33.0' }], model: null }))
  assert.match(failing.root.textContent, /0\.30\.0 is older than 0\.33\.0/)
  const tie = draw(modelView({ focus: 'ask', model: null, ask: [{ id: 'a', name: 'web', path: '/home/acme/web' }, { id: 'b', name: 'web', path: '/home/acme/web-2' }] }))
  const pick = byAction(tie.root, 'choose')
  assert.equal(pick.length, 2)
  click(pick[1])
  assert.deepEqual(tie.calls, ['choose b'])
})

test('a diff is shown as text, a refused diff in craftar words; remote workspaces are listed as not read', () => {
  const shown = draw(modelView(), { path: '.claude/rules/workflow.md', text: '+ Forge change.<b>x</b>' })
  assert.match(shown.root.textContent, /\+ Forge change\.<b>x<\/b>/)
  assert.equal(all(shown.root).some((e) => e.tag === 'b'), false)
  const refused = draw(modelView({ remote: [{ name: 'web', path: '/home/acme/elsewhere' }] }), { path: 'x', refused: 'not produced by this workspace: x' })
  assert.match(refused.root.textContent, /not produced by this workspace: x/)
  assert.match(refused.root.textContent, /on another host, not read/)
})

test('no source of the panel inserts markup', () => {
  for (const f of ['./panel-view.ts', './panel.ts']) {
    const src = readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8')
    assert.doesNotMatch(src, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/)
  }
})

test("the diff's own warnings are shown with it, in craftar words", () => {
  const { root } = draw(modelView(), { path: '.claude/rules/workflow.md', text: '+ x', warnings: ['forge: cached copy (fetch failed)'] })
  assert.match(root.textContent, /forge: cached copy \(fetch failed\)/)
})

test('a failed check is boxed with what craftar said; a fetched Forge reads its fetch time, not "now"', () => {
  const v = modelView({}, ['a path leaves the workspace through a link'])
  v.model!.checkFailed = true
  v.model!.forge = { ...v.model!.forge!, freshness: 'fetched', fetchedAt: Date.UTC(2026, 10, 6, 14, 0) }
  const { root } = draw(v)
  assert.match(root.textContent, /craftar status exits 1/)
  assert.doesNotMatch(root.textContent, /fetched now/)
  assert.match(root.textContent, /fetched /)
})

test('the probe report is drawn as text, line by line, and absent until the probe ran', () => {
  const hostile = '<img src=x onerror=alert(1)>'
  assert.equal(all(draw(modelView()).root).some((e) => e.attrs['data-role'] === 'probe'), false)
  const { root } = draw(modelView({ probe: { at: 0, lines: ['craftar probe, S0 (spec 60 §12)', `  | ${hostile}`] } }))
  const box = all(root).find((e) => e.attrs['data-role'] === 'probe')
  assert.ok(box, 'a probe section')
  assert.equal(all(root).find((e) => e.attrs['data-role'] === 'probe-text')?.textContent, `craftar probe, S0 (spec 60 §12)\n  | ${hostile}`)
  assert.equal(all(root).some((e) => e.tag === 'img'), false)
})

// The user's ruling (2026-11-07): the logo's three squares beside "craftar" at the top of the panel, as an
// inline SVG (Orca takes only named icons for the panel tab and the status bar item).
test('the header draws the logo as an inline SVG of three squares, decorative, beside the title', () => {
  const { root } = draw(modelView())
  const header = all(root).find((e) => e.tag === 'header')
  assert.ok(header)
  const logo = all(header).find((e) => e.tag === 'svg' && e.attrs['data-role'] === 'logo')
  assert.ok(logo, 'an svg logo in the header')
  assert.equal(logo.ns, 'http://www.w3.org/2000/svg')
  assert.equal(logo.attrs['aria-hidden'], 'true')
  const fills = all(logo).filter((e) => e.tag === 'rect').map((e) => e.attrs.fill)
  // The dark tile first, as in the plugin icon (A2), so the light square reads on a light theme too.
  assert.deepEqual(fills, ['#0A0E13', '#E7ECF1', '#E9915A', '#7FB4D6'])
  assert.equal(all(header).some((e) => e.tag === 'image' || e.tag === 'img' || e.tag === 'use'), false)
})

test('the Forge card says when the ref does not move: a tag by name, a commit in fixed words, nothing otherwise', () => {
  const at = (pinned: 'tag' | 'commit' | null, ref: string | null) => {
    const v = modelView()
    v.model!.forge = { ...v.model!.forge!, freshness: 'fetched', fetchedAt: 0, ref, pinned }
    return all(draw(v).root).find((e) => e.attrs['data-role'] === 'pinned')?.textContent ?? null
  }
  assert.equal(at('tag', 'v1.2.0'), 'tag v1.2.0 does not move: a change merged in the Forge comes here once a newer tag is set as ref in craftar.yaml')
  assert.equal(at('commit', 'd2309dc201c9a5127285a83092fb3853b8926101'), 'a commit does not move: a change merged in the Forge comes here once a newer ref is set in craftar.yaml')
  assert.equal(at(null, 'main'), null)
  const hostile = '<b>v1</b>'
  const v = modelView()
  v.model!.forge = { ...v.model!.forge!, ref: hostile, pinned: 'tag' }
  const { root } = draw(v)
  assert.match(root.textContent, /tag <b>v1<\/b> does not move/)
  assert.equal(all(root).some((e) => e.tag === 'b'), false, 'the ref is text, never markup')
})

test("the Forge card says craftar's newer tag with the ref, as of the last fetch on a cached copy, and opens craftar.yaml", () => {
  const at = (forge: Partial<NonNullable<View['model']>['forge'] & object>) => {
    const v = modelView()
    v.model!.forge = { ...v.model!.forge!, freshness: 'fetched', fetchedAt: Date.UTC(2026, 10, 8, 20, 0), ref: 'v0.2.67', pinned: 'tag', newerTag: 'v0.2.68', ...forge }
    return v
  }
  const calls: string[] = []
  const doc = fakeDocument()
  const root = doc.createElement('main') as FakeEl
  render(doc as never, root as never, at({}), { choose: () => undefined, refresh: () => undefined, showDiff: () => undefined, configOpen: () => calls.push('open') })
  const line = all(root).find((e) => e.attrs['data-role'] === 'newer-tag')!
  assert.match(line.textContent, /^newer tag on the Forge: v0\.2\.68 \(ref is v0\.2\.67\)\. Set ref in craftar\.yaml to move\./)
  assert.equal(all(root).some((e) => e.attrs['data-role'] === 'pinned'), false, 'the newer-tag line stands for the pinned line')
  click(byAction(line, 'config-open')[0])
  assert.deepEqual(calls, ['open'])
  const cached = all(draw(at({ freshness: 'cached' })).root).find((e) => e.attrs['data-role'] === 'newer-tag')!
  assert.match(cached.textContent, /\(ref is v0\.2\.67\), as of the last fetch /)
  const none = draw(at({ newerTag: null }))
  assert.equal(all(none.root).some((e) => e.attrs['data-role'] === 'newer-tag'), false)
  assert.equal(all(none.root).some((e) => e.attrs['data-role'] === 'pinned'), true)
  const hostile = draw(at({ newerTag: '<b>v1</b>' }))
  assert.equal(all(hostile.root).some((e) => e.tag === 'b'), false, 'the tag is text, never markup')
})
