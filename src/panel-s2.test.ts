// S2 in the approved panel (spec 60 §7, O2): the worker's update, sync, consent and last update drawn by the
// design's cards, with the real actions — the confirm sends exactly its list; nothing the worker says is dropped.
import { assert, test } from 'orca/testing'
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
  return {
    focus: 'one', selfCheck: [], model, readFailed: false, ask: [], remote: [], probe: null,
    update: { allowed: true, reason: null, files: [{ path: '.claude/rules/workflow.md', state: 'update' }] },
    sync: { phase: 'idle', message: null }, consent: null, lastSync: null, ...over,
  }
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

test('with the worker allowing it, Update opens the confirm and Update and stage sends exactly that list', () => {
  const { root, calls } = draw(view())
  const b = byAction(root, 'update')[0]
  assert.equal(b.attrs.disabled, undefined)
  click(b)
  click(byAction(root, 'update-confirm')[0])
  assert.deepEqual(calls, ['update .claude/rules/workflow.md'])
})

test("the worker's refusal of a panel request is drawn as a notice", () => {
  const { root } = draw(view(), 'the files changed since the panel showed them — look again and confirm')
  assert.equal(all(root).find((e) => e.attrs['data-role'] === 'notice')?.textContent, 'the files changed since the panel showed them — look again and confirm')
  const none = draw(view({ focus: 'none', model: null }), 'no craftar workspace has the focus')
  assert.equal(all(none.root).find((e) => e.attrs['data-role'] === 'notice')?.textContent, 'no craftar workspace has the focus')
})

test('the last update lists what was written and what was left out of the commit too', () => {
  const { root } = draw(view({
    sync: { phase: 'done', message: null },
    lastSync: { written: ['.claude/rules/workflow.md'], removed: [], kept: [], staged: ['.claude/rules/workflow.md'], leftOut: ['ignored/x.md'], differences: [], warnings: [], rerun: false },
  }))
  const role = (r: string) => all(root).filter((e) => e.attrs['data-role'] === r).map((e) => e.textContent)
  assert.deepEqual(role('written'), ['.claude/rules/workflow.md'])
  assert.deepEqual(role('left-out'), ['ignored/x.md'])
})

test('the consent card offers the terminal only when the worker says so, and calls it', () => {
  const text = 'writing is not allowed in this workspace — a person types craftar mcp allow-writes in it, in a terminal, to allow it'
  const { root, calls } = draw(view({ sync: { phase: 'consent', message: text }, consent: { text, terminal: 'offered', steps: [] } }))
  click(byAction(root, 'consent-terminal')[0])
  assert.deepEqual(calls, ['consent terminal'])
  const words = draw(view({ sync: { phase: 'consent', message: text }, consent: { text, terminal: 'words', steps: ['Open a terminal in this workspace.'] } }))
  assert.equal(byAction(words.root, 'consent-terminal').length, 0)
})

test("a consent refusal is said once, in the consent card — not again as the sync's message", () => {
  const text = 'writing is not allowed in this workspace — a person types craftar mcp allow-writes in it, in a terminal, to allow it'
  const { root } = draw(view({ sync: { phase: 'consent', message: text }, consent: { text, terminal: 'offered', steps: [] } }))
  const said = all(root).filter((e) => e.children.length === 0 && e.textContent === text)
  assert.equal(said.length, 1)
  assert.equal(all(root).some((e) => e.attrs['data-role'] === 'sync-note' || e.attrs['data-role'] === 'sync-error'), false)
})
