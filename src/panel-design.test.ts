// The layout the user approved on 2026-11-08: the bell, the sync diagram (Forge, craftar sync, one card per
// surface, the workspace and its profile), the files both ways and the actions in a footer toolbar; S2's parts
// drawn from its contract when the worker gives it (absent: drawn disabled). Every value stays text.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { all, byAction, click, fakeDocument, type FakeEl } from '../test-support/fake-dom'
import { fixture } from '../test-support/stub-craftar'
import { buildModel, type PanelModel } from './model'
import { type PanelView, render } from './panel-view'

const WS = '/home/acme/web'

function view(edit: (m: PanelModel) => void = () => {}, over: Partial<PanelView> = {}): PanelView {
  const model = buildModel({
    ws: WS,
    name: 'web',
    status: JSON.parse(fixture('status.json')),
    drift: JSON.parse(fixture('drift-show.json')),
    repos: JSON.parse(fixture('repos.json')),
    registry: JSON.parse(fixture('workspaces.json')),
    fetchedAt: null,
    readAt: 0,
  })
  edit(model)
  return { focus: 'one', selfCheck: [{ level: 'ok', message: 'version 1.3.0' }], model, readFailed: false, ask: [], remote: [], probe: null, ...over }
}

function draw(v: PanelView) {
  const doc = fakeDocument()
  const root = doc.createElement('main') as FakeEl
  const calls: string[] = []
  render(doc as never, root as never, v, {
    choose: (id) => calls.push(`choose ${id}`),
    refresh: () => calls.push('refresh'),
    showDiff: (p) => calls.push(`diff ${p}`),
    updateRun: (files) => calls.push(`update ${files.join(',')}`),
    consentTerminal: () => calls.push('consent'),
  })
  return { root, calls }
}

const cls = (e: FakeEl): string[] => (e.attrs.class ?? '').split(/\s+/).filter(Boolean)
const byClass = (root: FakeEl, c: string): FakeEl[] => all(root).filter((e) => cls(e).includes(c))
const role = (root: FakeEl, r: string): FakeEl[] => all(root).filter((e) => e.attrs['data-role'] === r)

const sync = (m: PanelModel) => {
  m.pending = []
  m.edited = []
  m.apart = []
  m.outputs = m.outputs.map((o) => ({ owner: o.owner, counts: { unchanged: 3 } }))
}

const state = (root: FakeEl): FakeEl | undefined => role(root, 'sync-state')[0]
const surfaces = (root: FakeEl): FakeEl[] => role(root, 'surface')

test('in sync: craftar sync says so in green, every surface reads up to date, and the toolbar has nothing to do', () => {
  const { root } = draw(view(sync))
  assert.ok(cls(state(root)!).includes('ok'))
  assert.match(state(root)!.textContent, /in sync/)
  assert.ok(surfaces(root).every((x) => /up to date/.test(x.textContent)))
  assert.equal(byAction(root, 'update').length, 0)
  assert.equal(byAction(root, 'send').length, 0)
  assert.equal(role(root, 'toolbar-empty').length, 1)
})

test('pending only: craftar sync counts what comes down and the commit move, and the toolbar offers Bring', () => {
  const { root } = draw(view((m) => ((m.edited = []), (m.apart = []))))
  assert.ok(cls(state(root)!).includes('active'))
  assert.match(root.textContent, /1 coming down from the Forge/)
  assert.match(root.textContent, /commit 4d764d6 → d2309dc/)
  assert.equal(byAction(root, 'update')[0].textContent, 'Bring 1 from the Forge')
  assert.equal(byAction(root, 'send').length, 0)
})

test('edited only: craftar sync counts what can go up, and the toolbar offers Send', () => {
  const { root } = draw(view((m) => ((m.pending = []), (m.apart = []))))
  assert.match(root.textContent, /1 can go up to the Forge/)
  assert.equal(byAction(root, 'send')[0].textContent, 'Send 1 to the Forge')
  assert.equal(byAction(root, 'update').length, 0)
})

test('edited files craftar will not send offer no Send and say how many were held back', () => {
  const { root } = draw(
    view((m) => {
      m.pending = []
      m.apart = []
      m.edited = [{ path: '.kiro/steering/x.md', state: 'drift', promotable: false, reason: 'kiro file — edit its .claude/ twin' }]
    }),
  )
  assert.equal(byAction(root, 'send').length, 0)
  assert.match(root.textContent, /1 edited here that craftar will not send \(see why below\)/)
  assert.match(root.textContent, /kiro file — edit its \.claude\/ twin/)
})

test('both ways: the toolbar holds Bring then Send, and the lists go down then up', () => {
  const { root } = draw(view())
  const bar = role(root, 'toolbar')[0]
  assert.deepEqual(all(bar).filter((e) => e.attrs['data-action']).map((e) => e.attrs['data-action']), ['update', 'send'])
  const lists = all(root).filter((e) => (e.attrs['data-role'] ?? '').startsWith('list-')).map((e) => e.attrs['data-role'])
  assert.deepEqual(lists.slice(0, 2), ['list-down', 'list-up'])
})

test("a refused sync says so in red in the diagram, with craftar words in the card; Bring is off, Send stays craftar's call", () => {
  const { root } = draw(
    view((m) => {
      m.refused = true
      m.unset = [{ key: 'acme.key', declaredBy: ['rule/x'], citedBy: ['rule/x'] }]
    }),
  )
  assert.ok(cls(state(root)!).includes('bad'))
  assert.match(state(root)!.textContent, /sync refused/)
  assert.match(root.textContent, /sync refused: declared parameter\(s\) with no value: acme\.key/)
  assert.equal(byAction(root, 'update')[0].getAttribute('disabled'), '')
  // The worker never refuses a send on this, and drift show still marks the file promotable: no gate of the panel's own.
  const send = byAction(root, 'send')[0]
  assert.doesNotMatch(send.getAttribute('title') ?? '', /refuse/)
  assert.match(send.getAttribute('title') ?? '', /not built yet/) // this helper passes no sendPreview
})

test('with several files craftar can send, the toolbar names the one its click sends', () => {
  const { root } = draw(
    view((m) => {
      m.edited = [
        { path: '.claude/rules/commit-conventions.md', state: 'drift', promotable: true, reason: null },
        { path: '.claude/rules/release.md', state: 'drift', promotable: true, reason: null },
      ]
    }),
  )
  const b = byAction(root, 'send')[0]
  assert.equal(b.textContent, 'Send commit-conventions.md to the Forge')
  assert.equal(b.attrs['data-path'], '.claude/rules/commit-conventions.md')
})

test('a cached copy labels the Forge, says it in the diagram, and keeps Bring disabled with the reason', () => {
  const { root } = draw(view((m) => (m.forge = { ...m.forge!, freshness: 'cached', fetchedAt: null })))
  assert.match(role(root, 'freshness')[0].textContent, /cached copy/)
  assert.match(state(root)!.textContent, /could not fetch the Forge/)
  const update = byAction(root, 'update')
  assert.equal(update.length, 1)
  assert.equal(update[0].getAttribute('disabled'), '')
  assert.match(update[0].getAttribute('title') ?? '', /needs a fetch that works/)
})

test("one card per surface, named as craftar names the owner, with its state and counts; the workspace and its profile below", () => {
  const { root } = draw(view())
  const card = surfaces(root)[0]
  assert.match(card.textContent, /claude-code/)
  assert.doesNotMatch(card.textContent, /\.claude\//)
  assert.match(card.textContent, /drift/)
  assert.match(card.textContent, /1 to update, 1 edited/)
  const ws = role(root, 'workspace')[0]
  assert.match(ws.textContent, /workspace\s*web/)
  assert.equal(role(root, 'profile')[0].textContent, 'acme-web')
  assert.doesNotMatch(root.textContent, /Linked/)
})

test('a file in either list opens its diff', () => {
  const { root, calls } = draw(view())
  for (const b of byAction(root, 'diff')) click(b)
  assert.deepEqual(calls, ['diff .claude/rules/workflow.md', 'diff .claude/rules/commit-conventions.md'])
})

test("the bell holds craftar's messages, opens on a click, and opens by itself when craftar reports an error", () => {
  const { root } = draw(view((m) => ((m.warnings = ['plan: <b>a warning</b>']), (m.errors = []))))
  const pop = role(root, 'messages')[0]
  assert.equal(pop.attrs.class, 'pop')
  assert.equal(role(root, 'messages-count')[0].textContent, '1')
  assert.equal(role(pop, 'warning')[0].textContent, 'plan: <b>a warning</b>')
  click(byAction(root, 'messages')[0])
  assert.equal(pop.attrs.class, 'pop open')
  const err = draw(view((m) => (m.errors = ['drift show: failed'])))
  assert.equal(role(err.root, 'messages')[0].attrs.class, 'pop open')
  assert.equal(role(err.root, 'error')[0].textContent, 'drift show: failed')
})

test('before S2: Update and Send are disabled with a note saying they are not built yet', () => {
  const { root } = draw(view())
  for (const a of ['update', 'send', 'send-file']) {
    const b = byAction(root, a)
    assert.ok(b.length > 0, a)
    assert.equal(b[0].getAttribute('disabled'), '', a)
  }
  assert.match(root.textContent, /not built yet/)
})

test("S2's contract: an allowed update asks first, listing the files, then runs with exactly those paths", () => {
  const { root, calls } = draw(view(undefined, { update: { allowed: true, reason: null, files: [{ path: '.claude/rules/workflow.md', state: 'update' }] } }))
  const update = byAction(root, 'update')[0]
  assert.equal(update.getAttribute('disabled'), null)
  assert.equal(update.textContent, 'Bring 1 from the Forge')
  click(update)
  const confirm = byAction(root, 'update-confirm')
  assert.equal(confirm.length, 1)
  const box = role(root, 'update-confirm-box')[0]
  assert.match(box.textContent, /Update 1 file and add it to your commit\?/)
  assert.deepEqual(role(root, 'update-file').map((e) => e.textContent), ['.claude/rules/workflow.md'])
  click(byAction(root, 'update-cancel')[0])
  assert.equal(byAction(root, 'update-confirm').length, 0)
  assert.deepEqual(calls, [])
  click(byAction(root, 'update')[0])
  click(byAction(root, 'update-confirm')[0])
  assert.deepEqual(calls, ['update .claude/rules/workflow.md'])
})

test("S2's contract: a refused update is disabled with the worker's reason, a running one is busy", () => {
  const no = draw(view(undefined, { update: { allowed: false, reason: 'craftar 0.34.0 is older than 0.35.0', files: [] } }))
  const b = byAction(no.root, 'update')[0]
  assert.equal(b.getAttribute('disabled'), '')
  assert.equal(b.getAttribute('title'), 'craftar 0.34.0 is older than 0.35.0')
  assert.match(no.root.textContent, /craftar 0\.34\.0 is older than 0\.35\.0/)
  const busy = draw(view(undefined, { update: { allowed: true, reason: null, files: [] }, sync: { phase: 'running', message: null } }))
  const r = byAction(busy.root, 'update')[0]
  assert.equal(r.getAttribute('disabled'), '')
  assert.equal(r.getAttribute('aria-busy'), 'true')
})

test("S2's contract: the consent offers a terminal or shows the steps as text; the last sync lists staged, kept and differences", () => {
  const offered = draw(view(undefined, { consent: { text: 'writes are not allowed here', terminal: 'offered', steps: [] } }))
  assert.match(offered.root.textContent, /writes are not allowed here/)
  click(byAction(offered.root, 'consent-terminal')[0])
  assert.deepEqual(offered.calls, ['consent'])
  const words = draw(view(undefined, { consent: { text: 'no', terminal: 'words', steps: ['open a terminal', '<b>type</b>'] } }))
  assert.equal(byAction(words.root, 'consent-terminal').length, 0)
  assert.match(words.root.textContent, /<b>type<\/b>/)
  const last = draw(
    view(undefined, {
      lastSync: {
        written: ['a.md'],
        removed: [],
        kept: [{ path: 'k.md', state: 'drift', reason: 'hand-edited' }],
        staged: ['a.md', 'craftar.lock'],
        differences: ['b.md changed since the question'],
        warnings: ['w'],
        rerun: false,
      },
    }),
  )
  assert.deepEqual(role(last.root, 'staged').map((e) => e.textContent), ['a.md', 'craftar.lock'])
  assert.match(role(last.root, 'kept')[0].textContent, /k\.md/)
  assert.deepEqual(role(last.root, 'difference').map((e) => e.textContent), ['b.md changed since the question'])
})

test('no craftar workspace in focus: the empty card names craftar init and Check again refreshes', () => {
  const { root, calls } = draw(view(undefined, { focus: 'none', model: null }))
  assert.match(root.textContent, /craftar\.yaml/)
  assert.match(root.textContent, /craftar init/)
  click(byAction(root, 'refresh').at(-1)!)
  assert.deepEqual(calls, ['refresh'])
})

test('craftar missing: not usable, the self-check lines verbatim, Check again', () => {
  const { root } = draw(view(undefined, { model: null, focus: 'none', selfCheck: [{ level: 'error', message: 'craftar: not found on the absolute entries of PATH' }] }))
  assert.match(role(root, 'status-line')[0].textContent, /craftar: not usable/)
  assert.match(root.textContent, /craftar: not found on the absolute entries of PATH/)
  assert.ok(byAction(root, 'refresh').length >= 2)
})

test('the status line reads the version from the self-check; the Forge says where it is read from; the workspace names its path', () => {
  const empty = draw(view(undefined, { focus: 'none', model: null }))
  assert.match(role(empty.root, 'status-line')[0].textContent, /craftar 1\.3\.0/)
  const { root } = draw(view())
  assert.match(role(root, 'freshness')[0].textContent, /on this machine/)
  assert.match(role(root, 'workspace')[0].textContent, /\/home\/acme\/web/)
})

test('the stylesheet keys the plugin tokens on Orca theme classes, defines no Orca variable, and stops motion on request', () => {
  const src = readFileSync(fileURLToPath(new URL('./panel.ts', import.meta.url)), 'utf8')
  assert.match(src, /html\.dark\s*\{[^}]*--ember:\s*#E9915A/)
  assert.match(src, /html\.light\s*\{[^}]*--ember:\s*#C8642C/)
  assert.doesNotMatch(src, /--orca-[a-z-]+\s*:/)
  const reduced = src.slice(src.indexOf('@media (prefers-reduced-motion: reduce)'))
  assert.match(reduced, /animation:\s*none !important/)
  assert.match(reduced, /transition:\s*none !important/)
  // Item 2: the page paints no background of its own, so Orca's sidebar shows through; no gradient anywhere.
  assert.match(src, /html, body \{ background: transparent;/)
  assert.doesNotMatch(src, /gradient\(/)
})

test('an allowed update with no way to run it yet stays disabled and says why', () => {
  const doc = fakeDocument()
  const root = doc.createElement('main') as FakeEl
  const v = view(undefined, { update: { allowed: true, reason: null, files: [{ path: '.claude/rules/workflow.md', state: 'update' }] } })
  render(doc as never, root as never, v, { choose: () => {}, refresh: () => {}, showDiff: () => {} })
  const b = byAction(root, 'update')[0]
  assert.equal(b.getAttribute('disabled'), '')
  assert.match(b.getAttribute('title') ?? '', /not built yet/)
})

test('an allowed update with no file to list is disabled, and the card counts what the confirm would list', () => {
  const { root } = draw(view(undefined, { update: { allowed: true, reason: null, files: [] } }))
  const b = byAction(root, 'update')[0]
  assert.equal(b.getAttribute('disabled'), '')
  assert.equal(b.textContent, 'Bring 0 from the Forge')
  assert.match(b.getAttribute('title') ?? '', /no file to bring yet: click Check again/)
})

test('a cached copy keeps Update disabled even when the worker says allowed', () => {
  const v = view((m) => (m.forge = { ...m.forge!, freshness: 'cached', fetchedAt: null }), { update: { allowed: true, reason: null, files: [{ path: '.claude/rules/workflow.md', state: 'update' }] } })
  const b = byAction(draw(v).root, 'update')[0]
  assert.equal(b.getAttribute('disabled'), '')
  assert.match(b.getAttribute('title') ?? '', /needs a fetch that works/)
})

test("craftar's sync message is shown verbatim whatever the phase, and lastSync's removed files and warnings are listed", () => {
  for (const phase of ['error', 'done', 'consent'] as const) {
    const { root } = draw(view(undefined, { sync: { phase, message: `craftar: <i>${phase}</i> said this` } }))
    assert.equal(role(root, 'sync-message')[0]?.textContent, `craftar: <i>${phase}</i> said this`, phase)
  }
  const { root } = draw(
    view(undefined, { lastSync: { written: [], removed: [{ path: 'old.md', reason: 'orphan: no longer produced' }], kept: [], staged: [], differences: [], warnings: ['plan: a warning'], rerun: true } }),
  )
  assert.equal(role(root, 'removed')[0].textContent, 'old.md · orphan: no longer produced')
  assert.ok(role(root, 'warning').some((e) => e.textContent === 'plan: a warning'))
  assert.equal(role(root, 'rerun').length, 1)
})

test('a failed read is a bad card with Check again; a tie names each workspace by name and path in the new design', () => {
  const failed = draw(view(undefined, { readFailed: true, model: null }))
  assert.match(failed.root.textContent, /craftar status gave no document/)
  click(byAction(failed.root, 'refresh').at(-1)!)
  assert.deepEqual(failed.calls, ['refresh'])
  const tie = draw(view(undefined, { focus: 'ask', model: null, ask: [{ id: 'a', name: 'web', path: '/home/acme/web' }, { id: 'b', name: 'web', path: '/home/acme/web-2' }] }))
  assert.match(tie.root.textContent, /Which workspace are you working in\?/)
  const b = byAction(tie.root, 'choose')
  assert.deepEqual(b.map((e) => e.textContent), ['web/home/acme/web', 'web/home/acme/web-2'])
})

test('the missing-craftar card names no version of its own (the self-check says the floor)', () => {
  const { root } = draw(view(undefined, { model: null, focus: 'none', selfCheck: [{ level: 'error', message: 'craftar: not found' }] }))
  const card = byClass(root, 'empty')[0]
  assert.doesNotMatch(card.textContent, /\d+\.\d+\.\d+/)
})

test('no craftar workspace: the logo is drawn animated — the top square linked to the orange and the blue one', () => {
  const { root } = draw(view(undefined, { focus: 'none', model: null }))
  const art = role(root, 'empty-art')[0]
  assert.deepEqual(byClass(art, 'art-box').map((e) => cls(e).join(' ')), ['art-box w', 'art-box o', 'art-box b'])
  assert.equal(byClass(art, 'art-link').length, 2)
  assert.equal(byClass(art, 'art-top').length, 1)
  const src = readFileSync(fileURLToPath(new URL('./panel.ts', import.meta.url)), 'utf8')
  assert.match(src, /\.art-link \{[^}]*animation: link-flow/)
  assert.match(src, /\.art-top \{ animation: lift/)
})

test('the Bring screen lists every file, craftar.lock and what stays as edited, in place of the main view, with its own toolbar', () => {
  const { root, calls } = draw(view(undefined, { update: { allowed: true, reason: null, files: [{ path: '.claude/rules/workflow.md', state: 'update' }] } }))
  click(byAction(root, 'update')[0])
  assert.equal(role(root, 'list-down').length, 0)
  assert.match(root.textContent, /craftar\.lockstaged too/)
  assert.match(root.textContent, /Kept as you edited it/)
  assert.match(root.textContent, /\.claude\/rules\/commit-conventions\.md/)
  const bar = role(root, 'toolbar')[0]
  assert.deepEqual(all(bar).filter((e) => e.attrs['data-action']).map((e) => e.attrs['data-action']), ['update-cancel', 'update-confirm'])
  assert.deepEqual(calls, [])
})

test("the Forge card shows where it was read from on a line of its own, under its path, not in the title row", () => {
  const { root } = draw(view())
  const forge = role(root, 'forge')[0]
  const title = all(forge).find((e) => (e.attrs.class ?? '').split(/\s+/).includes('t'))!
  assert.equal(all(title).filter((e) => e.attrs['data-role'] === 'freshness').length, 0)
  const lines = forge.children.map((e) => e.attrs['data-role'] ?? e.attrs.class)
  assert.equal(lines[lines.length - 1], 'freshness')
  assert.ok(lines.includes('s src'))
  assert.ok(lines.indexOf('s src') < lines.indexOf('freshness'))
})
