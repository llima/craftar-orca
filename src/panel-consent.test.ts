// P2 and P3 (the install test of 2026-11-09): the consent stays craftar's, typed by the person in a terminal; the card
// says what the terminal will ask and that the person types yes, before it opens, and says when craftar recorded the answer.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { all, byAction, click, fakeDocument, type FakeEl } from '../test-support/fake-dom'
import { fixture } from '../test-support/stub-craftar'
import { buildModel } from './model'
import { render } from './panel-view'
import type { View } from './worker'

function view(over: Partial<View> = {}): View {
  const model = buildModel({
    ws: '/home/acme/web',
    name: 'web',
    status: JSON.parse(fixture('status.json')),
    drift: JSON.parse(fixture('drift-show.json')),
    repos: JSON.parse(fixture('repos.json')),
    registry: JSON.parse(fixture('workspaces.json')),
    fetchedAt: null,
    readAt: 0,
  })
  // The fields this file never draws are left out, as they always were; the cast lets the type check accept that.
  return {
    focus: 'one', selfCheck: [], model, readFailed: false, ask: [], remote: [], probe: null,
    update: { allowed: true, reason: null, files: [{ path: '.claude/rules/workflow.md', state: 'update' }] },
    sync: { phase: 'idle', message: null }, consent: null, lastSync: null, ...over,
  } as View
}

function draw(v: View, notice: string | null = null) {
  const doc = fakeDocument()
  const root = doc.createElement('main') as FakeEl
  const calls: string[] = []
  render(doc as never, root as never, v, {
    choose: () => undefined, refresh: () => undefined, showDiff: () => undefined,
    updateRun: (files) => calls.push(`update ${files.join(',')}`),
    consentTerminal: () => calls.push('consent terminal'),
  }, null, notice)
  return { root, calls }
}

const TEXT = 'writing is not allowed in this workspace: run craftar mcp allow-writes in a terminal'
const QUESTION = 'Let craftar mcp --allow-writes write here [yes/no]: '
const role = (root: FakeEl, r: string): FakeEl[] => all(root).filter((e) => e.attrs['data-role'] === r)

test('P2: before the terminal opens, the card says what craftar will ask and to type yes, highlighted', () => {
  const { root } = draw(view({ sync: { phase: 'consent', message: TEXT }, consent: { text: TEXT, terminal: 'offered', steps: [] } }))
  const card = role(root, 'consent')[0]
  const explain = role(card, 'consent-explain')
  assert.equal(explain.length, 1)
  assert.match(explain[0].attrs.class ?? '', /\bbad\b/, 'in the alert colour')
  assert.ok(explain[0].textContent.includes(QUESTION), "craftar's own question, verbatim")
  assert.match(explain[0].textContent, /type yes/)
  assert.match(explain[0].textContent, /Forge, the ref and the profile/)
  const kids = all(card)
  assert.ok(kids.indexOf(explain[0]) < kids.indexOf(byAction(card, 'consent-terminal')[0]), 'said before the button')
})

test('P2: the steps in words (no terminal the plugin can open) carry the same explanation', () => {
  const { root } = draw(view({ sync: { phase: 'consent', message: TEXT }, consent: { text: TEXT, terminal: 'words', steps: ['Open a terminal in this workspace.'] } }))
  const explain = role(role(root, 'consent')[0], 'consent-explain')
  assert.equal(explain.length, 1)
  assert.ok(explain[0].textContent.includes(QUESTION))
})

test('P3: once craftar recorded the answer, the card says writes are allowed and offers no terminal', () => {
  const { root } = draw(view({ sync: { phase: 'consent', message: TEXT }, consent: { text: TEXT, terminal: 'offered', steps: [], answer: 'recorded' } }))
  assert.equal(role(root, 'consent').length, 0)
  const ok = role(root, 'consent-recorded')
  assert.equal(ok.length, 1)
  assert.match(ok[0].textContent, /Writes are allowed here/)
  assert.match(ok[0].textContent, /Bring/)
  assert.equal(byAction(root, 'consent-terminal').length, 0)
})

test('P3: an answer of no is said, and the terminal is offered again', () => {
  const { root, calls } = draw(view({ sync: { phase: 'consent', message: TEXT }, consent: { text: TEXT, terminal: 'offered', steps: [], answer: 'cancelled' } }))
  const card = role(root, 'consent')[0]
  assert.match(role(card, 'consent-cancelled')[0]?.textContent ?? '', /nothing was recorded/)
  click(byAction(card, 'consent-terminal')[0])
  assert.deepEqual(calls, ['consent terminal'])
})

test('P3: while craftar syncs, a progress strip says so in words, as a live region', () => {
  const { root } = draw(view({ sync: { phase: 'running', message: null } }))
  const p = role(root, 'progress')
  assert.equal(p.length, 1)
  assert.equal(p[0].attrs.role, 'status')
  assert.equal(p[0].attrs['aria-live'], 'polite')
  assert.match(p[0].textContent, /craftar is bringing the files from the Forge/)
  assert.ok(all(p[0]).some((e) => (e.attrs.class ?? '').split(' ').includes('bar')), 'an indeterminate bar')
})

test('P3: no progress strip when nothing runs', () => {
  const { root } = draw(view())
  assert.equal(role(root, 'progress').length, 0)
})

test('P3: a first read shows the strip too, in place of the bare Reading line', () => {
  const { root } = draw(view({ model: null, focus: 'one' }))
  const p = role(root, 'progress')
  assert.equal(p.length, 1)
  assert.match(p[0].textContent, /craftar is reading this workspace/)
})

// craftar 1.10.1 asks `[yes/no]`: the card quotes the question the person's craftar asks, by the self-check's version
// (the user's ruling of 2026-11-10), the newest words when the version is not known.
const Q_1_9 = 'Let craftar mcp --allow-writes write here [no]: '
const Q_1_10_0 = 'Let craftar mcp --allow-writes write here? Type yes or no [no]: '
const Q_1_10_1 = 'Let craftar mcp --allow-writes write here [yes/no]: '
const explainFor = (version: string | null): string => {
  const selfCheck = version === null ? [] : [{ level: 'ok' as const, message: `version ${version}` }]
  const { root } = draw(view({ selfCheck, sync: { phase: 'consent', message: TEXT }, consent: { text: TEXT, terminal: 'offered', steps: [] } } as never))
  return role(role(root, 'consent')[0], 'consent-explain')[0].textContent
}

test('the consent card quotes the question by craftar version: 1.10.1 and above ask [yes/no]', () => {
  for (const v of ['1.10.1', '1.11.0', '2.0.0']) {
    const text = explainFor(v)
    assert.ok(text.includes(Q_1_10_1), v)
    assert.ok(!text.includes(Q_1_10_0) && !text.includes(Q_1_9), v)
  }
})

test('the consent card quotes the question by craftar version: 1.10.0 asks its own words', () => {
  const text = explainFor('1.10.0')
  assert.ok(text.includes(Q_1_10_0))
  assert.ok(!text.includes(Q_1_10_1))
})

test('the consent card quotes the question by craftar version: below 1.10.0 the [no] words', () => {
  for (const v of ['1.9.0', '0.35.0', '1.9.9']) {
    const text = explainFor(v)
    assert.ok(text.includes(Q_1_9), v)
    assert.ok(!text.includes(Q_1_10_1) && !text.includes(Q_1_10_0), v)
  }
})

test('the consent card quotes the newest words when craftar version is not known', () => {
  assert.ok(explainFor(null).includes(Q_1_10_1))
  assert.ok(explainFor('not-a-version').includes(Q_1_10_1))
})

test('the instructions beside the quote stay true for every version', () => {
  for (const v of ['1.9.0', '1.10.0', '1.10.1']) {
    const text = explainFor(v)
    assert.match(text, /type yes and press Enter/, v)
    assert.match(text, /Enter alone, or no, answers no/, v)
  }
})
