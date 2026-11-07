// The approved panel design (agent 62, the user's approval of 2026-11-07): the state pill, the Forge ↔ workspace
// tree with two lanes, the cards, the flat lists, and S2's cards drawn from its contract when the worker gives
// it (absent: drawn disabled). Every value stays text.
import { assert, test } from 'orca/testing'
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
const pill = (root: FakeEl): FakeEl | undefined => role(root, 'state-pill')[0]
const lane = (root: FakeEl, dir: 'down' | 'up'): string[] => cls(byClass(root, 'lane').find((e) => cls(e).includes(dir)) as FakeEl)
const comets = (root: FakeEl): string[] => byClass(root, 'comet').map((e) => cls(e).join(' '))

const sync = (m: PanelModel) => {
  m.pending = []
  m.edited = []
  m.apart = []
}

test('in sync: a green pill, both lanes idle with the pulse dot, no comet', () => {
  const { root } = draw(view(sync))
  assert.equal(pill(root)?.textContent, 'in sync')
  assert.ok(cls(pill(root)!).includes('ok'))
  assert.ok(lane(root, 'down').includes('idle'))
  assert.ok(lane(root, 'up').includes('idle'))
  assert.equal(byClass(root, 'dot-pulse').length, 1)
  assert.deepEqual(comets(root), [])
  assert.match(root.textContent, /in sync/)
})

test('pending only: the down lane is lit with an ember comet, the commit move is said, and the down card is drawn', () => {
  const { root } = draw(view((m) => (m.edited = [])))
  assert.equal(pill(root)?.textContent, '1 pending')
  assert.ok(cls(pill(root)!).includes('em'))
  assert.ok(lane(root, 'down').includes('on'))
  assert.ok(!lane(root, 'up').includes('on'))
  assert.deepEqual(comets(root), ['comet e'])
  assert.match(root.textContent, /1 coming down from the Forge/)
  assert.match(root.textContent, /commit 4d764d6 → d2309dc/)
  assert.match(root.textContent, /Update 1 file and add it to your commit\?/)
  assert.equal(byAction(root, 'send').length, 0)
})

test('edited only: the up lane is lit with a steel comet when a file can go up, and the up card is drawn', () => {
  const { root } = draw(view((m) => (m.pending = [])))
  assert.equal(pill(root)?.textContent, '1 to send up')
  assert.ok(cls(pill(root)!).includes('st'))
  assert.ok(lane(root, 'up').includes('on'))
  assert.deepEqual(comets(root), ['comet s'])
  assert.match(root.textContent, /Send 1 edited file up to the Forge\?/)
  assert.equal(byAction(root, 'update').length, 0)
})

test('edited files craftar will not send light no lane and say how many were held back', () => {
  const { root } = draw(
    view((m) => {
      m.pending = []
      m.edited = [{ path: '.kiro/steering/x.md', state: 'drift', promotable: false, reason: 'kiro file — edit its .claude/ twin' }]
    }),
  )
  assert.equal(pill(root)?.textContent, '1 edited')
  assert.ok(!lane(root, 'up').includes('on'))
  assert.deepEqual(comets(root), [])
  assert.match(root.textContent, /1 edited here that craftar will not send — see why below/)
  assert.match(root.textContent, /kiro file — edit its \.claude\/ twin/)
})

test('both: two comets, the pill counts both ways, the down card comes before the up card', () => {
  const { root } = draw(view())
  assert.equal(pill(root)?.textContent, '1 ↓ · 1 ↑')
  assert.deepEqual(comets(root), ['comet e', 'comet s'])
  const cards = byClass(root, 'cta').map((e) => e.attrs['data-role'])
  assert.deepEqual(cards, ['update-card', 'send-card'])
})

test('a refused sync breaks both lanes, with no comet, a red pill and craftar words in the card', () => {
  const { root } = draw(
    view((m) => {
      m.refused = true
      m.unset = [{ key: 'acme.key', declaredBy: ['rule/a'], citedBy: ['rule/a'] }]
    }),
  )
  assert.equal(pill(root)?.textContent, 'sync refused')
  assert.ok(cls(pill(root)!).includes('bad'))
  assert.ok(lane(root, 'down').includes('broken'))
  assert.ok(lane(root, 'up').includes('broken'))
  assert.deepEqual(comets(root), [])
  assert.match(root.textContent, /sync refused: declared parameter\(s\) with no value: acme\.key/)
  assert.equal(byAction(root, 'update').length, 0)
})

test('a cached copy breaks the lanes, labels the Forge, and keeps Update disabled with the reason', () => {
  const { root } = draw(view((m) => (m.forge = { ...m.forge!, freshness: 'cached', fetchedAt: Date.UTC(2026, 10, 7, 10, 0) })))
  assert.equal(pill(root)?.textContent, 'cached copy')
  assert.ok(cls(pill(root)!).includes('warn'))
  assert.ok(lane(root, 'down').includes('broken'))
  assert.match(root.textContent, /could not fetch the Forge/)
  const update = byAction(root, 'update')
  assert.equal(update.length, 1)
  assert.equal(update[0].getAttribute('disabled'), '')
  assert.match(update[0].getAttribute('title') ?? '', /needs a fetch that works/)
})

test('the workspace branches show each output folder with its count and deltas', () => {
  const { root } = draw(view())
  const chip = byClass(root, 'chip')[0]
  assert.match(chip.textContent, /\.claude\//)
  assert.match(chip.textContent, /claude-code/)
  assert.ok(byClass(chip, 'delta').some((d) => d.textContent === '~1' && cls(d).includes('em')))
  assert.ok(byClass(chip, 'delta').some((d) => d.textContent === '✎1' && cls(d).includes('st')))
})

test('Review changes and Review edits open the first file of their list', () => {
  const { root, calls } = draw(view())
  click(byAction(root, 'review-down')[0])
  click(byAction(root, 'review-up')[0])
  assert.deepEqual(calls, ['diff .claude/rules/workflow.md', 'diff .claude/rules/commit-conventions.md'])
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
  assert.equal(update.textContent, 'Update and stage')
  click(update)
  const confirm = byAction(root, 'update-confirm')
  assert.equal(confirm.length, 1)
  assert.match(root.textContent, /Update 1 file and add it to your commit\?/)
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
  assert.equal(all(words.root).some((e) => e.tag === 'b'), false)
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

test('craftar missing: a red pill, the self-check lines verbatim, Check again', () => {
  const { root } = draw(view(undefined, { model: null, focus: 'none', selfCheck: [{ level: 'error', message: 'craftar: not found on the absolute entries of PATH' }] }))
  assert.equal(pill(root)?.textContent, 'no craftar')
  assert.match(root.textContent, /craftar: not found on the absolute entries of PATH/)
  assert.ok(byAction(root, 'refresh').length >= 2)
})

test('the footer reads the version from the self-check, and the workspace card names its path', () => {
  const { root } = draw(view())
  const footer = all(root).find((e) => e.tag === 'footer')!
  assert.match(footer.textContent, /craftar 1\.3\.0/)
  assert.match(footer.textContent, /Forge on this machine/)
  assert.match(root.textContent, /\/home\/acme\/web/)
})

test('the stylesheet keys the plugin tokens on Orca theme classes, defines no Orca variable, and stops motion on request', () => {
  const src = readFileSync(fileURLToPath(new URL('./panel.ts', import.meta.url)), 'utf8')
  assert.match(src, /html\.dark\s*\{[^}]*--ember:\s*#E9915A/)
  assert.match(src, /html\.light\s*\{[^}]*--ember:\s*#C8642C/)
  assert.doesNotMatch(src, /--orca-[a-z-]+\s*:/)
  const reduced = src.slice(src.indexOf('@media (prefers-reduced-motion: reduce)'))
  assert.match(reduced, /animation:\s*none !important/)
  assert.match(reduced, /transition:\s*none !important/)
  assert.match(reduced, /\.comet\s*\{\s*display:\s*none/)
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
