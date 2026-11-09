// A message that asks for a footer action sits in the footer, above the button it names, as the Forge clone box does (the
// user's ask of 2026-11-09); a message that asks for Check again carries that button at the end of its own card. Every
// button runs what the button it names runs: Bring opens the confirmation, never the write.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { all, byAction, click, fakeDocument, type FakeEl } from '../test-support/fake-dom'
import { fixture } from '../test-support/stub-craftar'
import { buildModel } from './model'
import { render, type PanelView } from './panel-view'
import type { View } from './worker'

const EDITED = '.claude/rules/commit-conventions.md'
const TEXT = 'writing is not allowed in this workspace: run craftar mcp allow-writes in a terminal'

function view(over: Partial<PanelView> = {}): PanelView {
  const model = buildModel({
    ws: '/home/acme/web', name: 'web', status: JSON.parse(fixture('status.json')), drift: JSON.parse(fixture('drift-show.json')),
    repos: JSON.parse(fixture('repos.json')), registry: JSON.parse(fixture('workspaces.json')), fetchedAt: null, readAt: 0,
  })
  return {
    focus: 'one', selfCheck: [], model, readFailed: false, ask: [], remote: [], probe: null,
    update: { allowed: true, reason: null, files: model.pending.map((p) => ({ path: p.path, state: p.state })) },
    sync: { phase: 'idle', message: null }, consent: null, lastSync: null, ...over,
  } as PanelView
}

function draw(v: PanelView) {
  const doc = fakeDocument()
  const root = doc.createElement('main') as FakeEl
  const calls: string[] = []
  render(doc as never, root as never, v, {
    choose: () => undefined, refresh: () => calls.push('refresh'), showDiff: () => undefined,
    updateRun: (files) => calls.push(`update ${files.join(',')}`),
    consentTerminal: () => calls.push('consent terminal'),
    sendCancel: () => calls.push('send cancel'), forgePrPrepare: () => calls.push('prepare'),
    sendAllRest: () => calls.push('rest'), forgePrStep: (st) => calls.push(`step ${st}`), forgePrShow: () => undefined, forgePrDrop: () => undefined,
    discardCancel: () => calls.push('discard cancel'), discardCheckAgain: () => calls.push('discard check again'),
  })
  return { root, calls }
}
const role = (root: FakeEl, r: string): FakeEl[] => all(root).filter((e) => e.attrs['data-role'] === r)
const bar = (root: FakeEl): FakeEl => role(root, 'toolbar')[0]
const body = (root: FakeEl): FakeEl => all(root).find((e) => e.attrs.class === 'body')!
const before = (root: FakeEl, a: FakeEl, b: FakeEl): boolean => all(root).indexOf(a) < all(root).indexOf(b)
const buttons = (el: FakeEl): FakeEl[] => all(el).filter((e) => e.tag === 'button')

test('the consent sits in the footer, above Bring, with its Open a terminal button last', () => {
  const { root, calls } = draw(view({ sync: { phase: 'consent', message: TEXT }, consent: { text: TEXT, terminal: 'offered', steps: [] } }))
  const card = role(root, 'consent')[0]
  assert.ok(card, 'drawn')
  assert.ok(all(bar(root)).includes(card), 'in the footer')
  assert.ok(!all(body(root)).includes(card), 'not in the body')
  assert.ok(before(root, card, byAction(root, 'update')[0]), 'above the Bring button')
  const own = buttons(card)
  assert.equal(own[own.length - 1].attrs['data-action'], 'consent-terminal', 'its button is the last one in it')
  click(own[own.length - 1])
  assert.deepEqual(calls, ['consent terminal'])
})

test('an answer of no names the button that opens the terminal again', () => {
  const { root } = draw(view({ sync: { phase: 'consent', message: TEXT }, consent: { text: TEXT, terminal: 'offered', steps: [], answer: 'cancelled' } }))
  assert.match(role(root, 'consent-cancelled')[0].textContent, /Click Open a terminal to allow writes/)
})

test('writes allowed: the note sits in the footer right above Bring, names it, and Bring opens the confirmation only', () => {
  const { root, calls } = draw(view({ sync: { phase: 'consent', message: TEXT }, consent: { text: TEXT, terminal: 'offered', steps: [], answer: 'recorded' } }))
  const ok = role(root, 'consent-recorded')[0]
  assert.ok(all(bar(root)).includes(ok), 'in the footer')
  assert.ok(!all(body(root)).includes(ok), 'not in the body')
  const bring = byAction(root, 'update')[0]
  assert.ok(before(root, ok, bring), 'above the Bring button')
  const label = bring.textContent.trim()
  assert.match(label, /^Bring \d+ from the Forge$/)
  assert.ok(ok.textContent.includes(`Click ${label} below`), 'names the button as it reads')
  click(bring)
  assert.deepEqual(calls, [], 'no write on the first click')
  assert.equal(role(root, 'update-confirm-box').length, 1, 'the confirmation is drawn')
})

test('a kept file after an update: the rerun note sits in the footer above Bring and names it', () => {
  const lastSync = { written: [], removed: [], kept: [{ path: EDITED, state: 'drift', reason: 'changed while craftar was writing' }], staged: [], differences: [], warnings: [], rerun: true }
  const { root } = draw(view({ lastSync }))
  const note = role(root, 'rerun')[0]
  assert.ok(all(bar(root)).includes(note), 'in the footer')
  const bring = byAction(root, 'update')[0]
  assert.ok(before(root, note, bring))
  assert.ok(note.textContent.includes(bring.textContent.trim()), 'names the button as it reads')
})

test('a send written: the next step note sits in the footer above Prepare the PR', () => {
  const PLAN = {
    workspace: '/home/acme/web', forge: '/home/acme/forge2', profile: 'acme-web', dryRun: false, path: EDITED, ingredient: 'rule/commit-conventions',
    outcome: 'variant', promoted: 'rule/commit-conventions--acme-web', written: [], params: [], sections: [], flattened: { params: [], sections: [] }, dependents: [], nextSync: { counts: {} },
    impact: { registry: 'read', workspaces: [] }, warnings: [],
  }
  const { root, calls } = draw(view({ send: { path: EDITED, phase: 'done', plan: PLAN as never, result: PLAN as never, message: null } } as never))
  const next = role(root, 'send-next')[0]
  assert.ok(next, 'drawn')
  assert.ok(all(bar(root)).includes(next), 'in the footer')
  const prepare = byAction(root, 'forgepr-prepare')[0]
  assert.ok(before(root, next, prepare))
  assert.match(next.textContent, /Prepare the PR/)
  click(prepare)
  assert.deepEqual(calls, ['prepare'])
})

test('files left after the commit: the note sits in the footer above Send the rest', () => {
  const pr: NonNullable<View['forgePr']> = {
    open: true, phase: 'committed', step: null, waiting: false, forge: '/home/acme/forge', paths: ['ingredients/rules/x--acme/rule.md'],
    branch: 'craftar-acme-x', title: 't', body: 'b', identity: 'Acme Dev <dev@acme.example>', forgeBranch: 'main', authorDiffers: null, url: null, attached: null, steps: [], note: null,
    rest: ['.claude/rules/frontend-react.md'],
  }
  const { root } = draw(view({ forgePr: pr } as never))
  const note = role(root, 'forgepr-rest')[0]
  assert.ok(all(bar(root)).includes(note), 'in the footer')
  assert.ok(before(root, note, byAction(root, 'sendall-rest')[0]))
})

test("craftar will not send: the card ends with Check again, which runs the header's Check again", () => {
  const { root, calls } = draw(view({ sendRefused: [{ path: EDITED, message: 'error: D17: reaches agent/x, local to this profile' }] } as never))
  const card = role(root, 'send-refused')[0]
  const own = buttons(card)
  const last = own[own.length - 1]
  assert.equal(last.attrs['data-action'], 'refresh')
  assert.equal(last.textContent.trim(), 'Check again')
  click(last)
  assert.deepEqual(calls, ['refresh'])
})

test('a discard that ran but could not read the workspace again: Back and check again ends its card, leaving and reading again', () => {
  const message = 'The discard ran, but reading the workspace again failed: x. Go back to the workspace and check again to see how the file reads now.'
  const v = view({ discard: { path: EDITED, deleted: false, diff: null, note: null, message, after: null, phase: 'error', readAgain: true } } as never)
  v.model!.pending = []
  const { root, calls } = draw(v)
  const card = role(root, 'discard-box')[0]
  const own = buttons(card)
  const last = own[own.length - 1]
  assert.equal(last.attrs['data-action'], 'discard-check-again')
  click(last)
  assert.deepEqual(calls, ['discard check again'])
  // A refusal that does not ask for it gets only the way back.
  const plain = view({ discard: { path: EDITED, deleted: false, diff: null, note: null, message: 'error: not drifted: x (unchanged)', after: null, phase: 'error' } } as never)
  plain.model!.pending = []
  assert.equal(byAction(draw(plain).root, 'discard-check-again').length, 0)
})

test('a Bring that cannot be clicked is never named as the next click: the note says why it waits', () => {
  const recorded = { sync: { phase: 'consent', message: TEXT }, consent: { text: TEXT, terminal: 'offered', steps: [], answer: 'recorded' } } as Partial<PanelView>
  const v = view({ ...recorded })
  v.model!.forge = { ...v.model!.forge!, freshness: 'cached', fetchedAt: null }
  const { root } = draw(v)
  assert.equal(byAction(root, 'update')[0].attrs.disabled, '', 'Bring is off on a cached copy')
  const ok = role(root, 'consent-recorded')[0]
  assert.doesNotMatch(ok.textContent, /Click Bring/)
  assert.match(ok.textContent, /Bring waits: /)
  const rerun = view({ lastSync: { written: [], removed: [], kept: [], staged: [], differences: [], warnings: [], rerun: true } })
  rerun.model!.forge = { ...rerun.model!.forge!, freshness: 'cached', fetchedAt: null }
  const note = role(draw(rerun).root, 'rerun')[0]
  assert.doesNotMatch(note.textContent, /Click Bring/)
  assert.match(note.textContent, /Bring waits: /)
})

test('while a sync runs, writes allowed names no button', () => {
  const { root } = draw(view({ sync: { phase: 'running', message: null }, consent: { text: TEXT, terminal: 'offered', steps: [], answer: 'recorded' } }))
  const ok = role(root, 'consent-recorded')[0]
  assert.equal(ok.textContent, 'Writes are allowed herecraftar recorded your yes: craftar will not ask for consent again.')
})

test('a kept file with nothing pending: the rerun note asks to bring the files once craftar lists them', () => {
  const v = view({ lastSync: { written: [], removed: [], kept: [], staged: [], differences: [], warnings: [], rerun: true } })
  v.model!.pending = []
  const { root } = draw(v)
  assert.equal(byAction(root, 'update').length, 0)
  assert.match(role(root, 'rerun')[0].textContent, /Bring the files again once craftar lists them\.$/)
})

test('a send written with no Prepare the PR: the next step note names no button', () => {
  const PLAN = {
    workspace: '/home/acme/web', forge: '/home/acme/forge2', profile: 'acme-web', dryRun: false, path: EDITED, ingredient: 'rule/commit-conventions',
    outcome: 'variant', promoted: 'rule/commit-conventions--acme-web', written: [], params: [], sections: [], flattened: { params: [], sections: [] }, dependents: [], nextSync: { counts: {} },
    impact: { registry: 'read', workspaces: [] }, warnings: [],
  }
  const doc = fakeDocument()
  const root = doc.createElement('main') as FakeEl
  render(doc as never, root as never, view({ send: { path: EDITED, phase: 'done', plan: PLAN as never, result: PLAN as never, message: null } } as never), {
    choose: () => undefined, refresh: () => undefined, showDiff: () => undefined, sendCancel: () => undefined,
  })
  const next = role(root, 'send-next')[0]
  assert.ok(next)
  assert.doesNotMatch(next.textContent, /Prepare the PR/)
  assert.equal(byAction(root, 'forgepr-prepare').length, 0)
})

test("a consent terminal Orca could not bring forward: its note comes before the button, which stays last", () => {
  const note = 'A terminal titled "craftar allow writes" was opened in this workspace, in the background.'
  const { root } = draw(view({ sync: { phase: 'consent', message: TEXT }, consent: { text: TEXT, terminal: 'offered', steps: [], note } }))
  const card = role(root, 'consent')[0]
  const own = buttons(card)
  assert.equal(own[own.length - 1].attrs['data-action'], 'consent-terminal')
  assert.ok(before(root, role(card, 'consent-note')[0], own[own.length - 1]))
})

test('the footer note for no file to bring says Check again is at the top', () => {
  const { root } = draw(view({ update: { allowed: true, reason: null, files: [] } }))
  assert.match(byAction(root, 'update')[0].attrs.title ?? '', /click Check again at the top/)
})
