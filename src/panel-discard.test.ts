// Discard in the panel (spec 60 §8a): the button on a drift and an orphan-drift row, never on the example file or a collision;
// "Update first" with anything pending; the confirmation with the diff (or craftar's note) and its second click; the outcome.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { all, byAction, click, fakeDocument, type FakeEl } from '../test-support/fake-dom'
import { fixture } from '../test-support/stub-craftar'
import { buildModel, type PanelModel } from './model'
import { render, type PanelView } from './panel-view'

const EDITED = '.claude/rules/commit-conventions.md'

function view(edit: (m: PanelModel) => void = () => {}, over: Partial<PanelView> = {}): PanelView {
  const model = buildModel({
    ws: '/home/acme/web', name: 'web', status: JSON.parse(fixture('status.json')), drift: JSON.parse(fixture('drift-show.json')),
    repos: JSON.parse(fixture('repos.json')), registry: JSON.parse(fixture('workspaces.json')), fetchedAt: null, readAt: 0,
  })
  edit(model)
  return { focus: 'one', selfCheck: [], model, readFailed: false, ask: [], remote: [], probe: null, ...over }
}
const quiet = (m: PanelModel) => { m.pending = [] }

function draw(v: PanelView) {
  const doc = fakeDocument()
  const root = doc.createElement('main') as FakeEl
  const calls: string[] = []
  render(doc as never, root as never, v, {
    choose: () => undefined, refresh: () => undefined, showDiff: () => undefined,
    discardOpen: (p) => calls.push(`open ${p}`), discardRun: (p) => calls.push(`run ${p}`), discardCancel: () => calls.push('cancel'),
  })
  return { root, calls }
}
const role = (root: FakeEl, r: string): FakeEl[] => all(root).filter((e) => e.attrs['data-role'] === r)

test('Discard is on a drift and an orphan-drift row, never on the example settings file or a collision', () => {
  const { root, calls } = draw(view((m) => {
    quiet(m)
    m.edited = [{ path: EDITED, state: 'drift', promotable: true, reason: null }, { path: '.claude/settings.craftar.example.json', state: 'drift', promotable: false, reason: 'example' }]
    m.apart = [{ path: '.claude/rules/old.md', state: 'orphan-drift' }, { path: '.claude/rules/mine.md', state: 'collision' }]
  }))
  assert.deepEqual(byAction(root, 'discard-file').map((b) => b.attrs['data-path']), [EDITED, '.claude/rules/old.md'])
  click(byAction(root, 'discard-file')[0])
  assert.deepEqual(calls, [`open ${EDITED}`])
})

test('with anything pending, the action reads Update first and is off', () => {
  const { root } = draw(view())
  const b = byAction(root, 'discard-file')[0]
  assert.equal(b.attrs.disabled, '')
  assert.equal(b.textContent, 'Update first')
  assert.match(b.attrs.title, /Update and stage/)
})

test('the confirmation names the file, shows the diff, says the edit is lost, and the second click runs it', () => {
  const d = { path: EDITED, phase: 'confirm' as const, deleted: false, diff: '- mine\n+ craftar', note: null, message: null, after: null }
  const { root, calls } = draw(view(quiet, { discard: d }))
  assert.match(role(root, 'discard-box')[0].textContent, /Discard your edit of \.claude\/rules\/commit-conventions\.md\?/)
  assert.match(role(root, 'discard-box')[0].textContent, /lost for good/)
  assert.equal(role(root, 'discard-diff')[0].textContent, '- mine\n+ craftar')
  click(byAction(root, 'discard-confirm')[0])
  click(byAction(root, 'discard-cancel')[0])
  assert.deepEqual(calls, [`run ${EDITED}`, 'cancel'])
  const del = draw(view(quiet, { discard: { ...d, deleted: true, diff: null, note: 'orphan-drift: no longer produced' } })).root
  assert.match(del.textContent, /Delete \.claude/)
  assert.equal(role(del, 'discard-withheld')[0].textContent, 'orphan-drift: no longer produced')
  const redrawn = draw(view(quiet, { discard: { ...d, message: 'The Forge moved since the confirmation: look at the diff again before you discard.' } })).root
  assert.match(role(redrawn, 'discard-note')[0].textContent, /Forge moved/)
})

test("while it runs, nothing to click; after it, the outcome, what else moved and craftar's words; a refusal as craftar words it", () => {
  const base = { path: EDITED, deleted: false, diff: null, note: null, message: null, after: null }
  const running = draw(view(quiet, { discard: { ...base, phase: 'running' } })).root
  assert.equal(byAction(running, 'discard-confirm').length, 0)
  assert.ok(all(running).some((e) => e.attrs['aria-busy'] === 'true'))
  const done = draw(view(quiet, { discard: { ...base, phase: 'done', after: { file: 'unchanged', others: ['b.md: unchanged → update'], warnings: ['a warning'], report: 'wrote x' } } })).root
  assert.match(role(done, 'discard-after')[0].textContent, /Now: unchanged\. Nothing was staged or committed\./)
  assert.deepEqual(role(done, 'discard-other').map((e) => e.textContent), ['b.md: unchanged → update'])
  assert.equal(role(done, 'discard-report')[0].textContent, 'wrote x')
  assert.equal(byAction(done, 'discard-again').length, 0)
  // craftar kept the file: no success, its report, and the discard offered again.
  const kept = draw(view(quiet, { discard: { ...base, phase: 'done', after: { file: 'drift', others: [], warnings: [], report: 'changed while craftar was writing: kept; run craftar sync again' } } }))
  assert.match(kept.root.textContent, /was not put back/)
  assert.match(role(kept.root, 'discard-report')[0].textContent, /changed while craftar was writing/)
  click(byAction(kept.root, 'discard-again')[0])
  assert.deepEqual(kept.calls, [`open ${EDITED}`])
  const err = draw(view(quiet, { discard: { ...base, phase: 'error', message: 'error: not drifted: x (unchanged)' } })).root
  assert.equal(role(err, 'discard-message')[0].textContent, 'error: not drifted: x (unchanged)')
})

test('with "Fetch a remote Forge" off for a remote Forge, Discard is off with the reason', () => {
  const { root } = draw(view(quiet, { discardOff: 'Discard needs a fetched Forge: turn "Fetch a remote Forge" on in the plugin settings' }))
  const b = byAction(root, 'discard-file')[0]
  assert.equal(b.attrs.disabled, '')
  assert.equal(b.textContent, 'Discard')
  assert.match(b.attrs.title, /Fetch a remote Forge/)
})
