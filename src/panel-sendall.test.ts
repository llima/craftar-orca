// Send all in the panel (the user's design A of 2026-11-08): the footer sends every file; one plan; Write all over exactly the
// planned files; a stop shows craftar's words and the files not written; the PR's Send the rest after its commit.
import { assert, test } from 'orca/testing'
import { all, byAction, click, fakeDocument, type FakeEl } from '../test-support/fake-dom'
import { fixture } from '../test-support/stub-craftar'
import { buildModel } from './model'
import { render, type PanelView } from './panel-view'
import type { View } from './worker'

const A = '.claude/rules/commit-conventions.md'
const B = '.claude/rules/frontend-react.md'
type SA = NonNullable<PanelView['sendAll']>
const plan = (path: string, name: string) => ({ dryRun: true, path, ingredient: `rule/${name}`, outcome: 'variant', promoted: `rule/${name}--acme-web`, written: [{ path: `ingredients/rules/${name}--acme-web/rule.md`, action: 'created' }], params: [], sections: [], impact: { registry: 'read', workspaces: [] }, warnings: ['plan: <b>a warning</b>'] })

function view(over: Partial<PanelView> = {}, two = true): PanelView {
  const status = JSON.parse(fixture('status.json'))
  const drift = JSON.parse(fixture('drift-show.json'))
  if (two) {
    status.statuses = status.statuses.map((x: { path: string; state: string }) => (x.path === B ? { ...x, state: 'drift' } : x))
    drift.files.push({ ...drift.files[0], path: B, ingredient: 'rule/frontend-react' })
  }
  const model = buildModel({ ws: '/home/acme/web', name: 'web', status, drift, repos: JSON.parse(fixture('repos.json')), registry: JSON.parse(fixture('workspaces.json')), fetchedAt: null, readAt: 0 })
  return { focus: 'one', selfCheck: [], model, readFailed: false, ask: [], remote: [], probe: null, ...over }
}

function draw(v: PanelView) {
  const doc = fakeDocument()
  const root = doc.createElement('main') as FakeEl
  const calls: string[] = []
  render(doc as never, root as never, v, {
    choose: () => undefined, refresh: () => undefined, showDiff: () => undefined,
    sendPreview: (p) => calls.push(`send ${p}`), sendAllPreview: () => calls.push('all'), sendAllRun: (ps) => calls.push(`run ${ps.join(',')}`),
    sendAllCancel: () => calls.push('cancel'), sendAllRest: () => calls.push('rest'), forgePrMore: () => calls.push('more'), forgePrPrepare: () => calls.push('prepare'),
    forgePrStep: (st) => calls.push(`step ${st}`), forgePrShow: () => undefined, forgePrDrop: () => undefined,
  })
  return { root, calls }
}
const role = (root: FakeEl, r: string): FakeEl[] => all(root).filter((e) => e.attrs['data-role'] === r)
const sa = (over: Partial<SA>): SA => ({ phase: 'plan', items: [{ path: A, plan: plan(A, 'commit-conventions'), result: null, refused: null }, { path: B, plan: plan(B, 'frontend-react'), result: null, refused: null }], current: null, stopped: null, remaining: [], message: null, more: false, ...over })

test('with two files to send, the footer reads "Send all 2 to the Forge"; with one it keeps the single Send', () => {
  const { root, calls } = draw(view())
  const b = byAction(root, 'send-all')[0]
  assert.equal(b.textContent.trim(), 'Send all 2 to the Forge')
  click(b)
  assert.deepEqual(calls, ['all'])
  // The rows still send one file each.
  assert.equal(byAction(root, 'send-file').length, 2)
  const one = draw(view({}, false))
  assert.equal(byAction(one.root, 'send-all').length, 0)
  assert.match(byAction(one.root, 'send')[0].textContent, /Send 1 to the Forge/)
})

test('the plan lists every file with its outcome and what craftar would write; Write all sends exactly the planned files', () => {
  const refused = sa({ items: [{ path: A, plan: plan(A, 'commit-conventions'), result: null, refused: null }, { path: B, plan: null, result: null, refused: 'error: D16: <i>refused</i>' }] })
  const { root, calls } = draw(view({ sendAll: refused }))
  assert.equal(role(root, 'sendall-title')[0].textContent, 'Send 1 file to the Forge?')
  assert.deepEqual(role(root, 'sendall-item').map((e) => all(e)[1].textContent), [`${A} · planned`, `${B} · refused`])
  assert.equal(role(root, 'sendall-refused')[0].textContent, 'error: D16: <i>refused</i>')
  assert.equal(all(root).some((e) => e.tag === 'i' || e.tag === 'b'), false, "craftar's words are text, never markup")
  click(byAction(root, 'sendall-confirm')[0])
  assert.deepEqual(calls, [`run ${A}`])
  const none = draw(view({ sendAll: sa({ items: [{ path: A, plan: null, result: null, refused: 'x' }] }) }))
  assert.equal(byAction(none.root, 'sendall-confirm')[0].attrs.disabled, '')
})

test('a stop shows craftar\'s words, the files not written, and the PR for what was written', () => {
  const written = { ...plan(A, 'commit-conventions'), dryRun: false }
  const stopped = sa({ phase: 'stopped', items: [{ path: A, plan: plan(A, 'commit-conventions'), result: written, refused: null }, { path: B, plan: plan(B, 'frontend-react'), result: null, refused: null }], stopped: { path: B, message: 'error: recipes/base.yaml is not held by git' }, remaining: [B] })
  const { root, calls } = draw(view({ sendAll: stopped }))
  assert.match(role(root, 'sendall-title')[0].textContent, /stopped at \.claude\/rules\/frontend-react\.md: 1 of 2 written/)
  assert.equal(role(root, 'sendall-stopped')[0].textContent, 'error: recipes/base.yaml is not held by git')
  assert.deepEqual(role(root, 'sendall-remaining').map((e) => e.textContent), [B])
  click(byAction(root, 'forgepr-prepare')[0])
  assert.deepEqual(calls, ['prepare'])
  // The rest of a PR: its commit goes on the branch.
  const more = draw(view({ sendAll: { ...stopped, phase: 'done', more: true, stopped: null, remaining: [] } }))
  click(byAction(more.root, 'forgepr-more')[0])
  assert.deepEqual(more.calls, ['more'])
  // Nothing written: no PR to prepare, only the way back.
  const nothing = draw(view({ sendAll: { ...stopped, items: stopped.items.map((x) => ({ ...x, result: null })), remaining: [A, B] } }))
  assert.equal(byAction(nothing.root, 'forgepr-prepare').length, 0)
  assert.equal(byAction(nothing.root, 'sendall-cancel').length, 1)
})

test('the PR committed with files left offers Send the rest before the push, and names them', () => {
  const pr: NonNullable<View['forgePr']> = {
    open: true, phase: 'committed', step: null, waiting: false, forge: '/home/acme/forge', paths: ['ingredients/rules/x--acme/rule.md'],
    branch: 'craftar-acme-x', title: 't', body: 'b', identity: 'Acme Dev <dev@acme.example>', forgeBranch: 'main', authorDiffers: null, url: null, attached: null, steps: [], note: null,
    rest: [B],
  }
  const { root, calls } = draw(view({ forgePr: pr }))
  click(byAction(root, 'sendall-rest')[0])
  assert.deepEqual(calls, ['rest'])
  assert.match(role(root, 'forgepr-rest')[0].textContent, /1 file was not written yet: \.claude\/rules\/frontend-react\.md/)
  assert.equal(byAction(root, 'forgepr-push').length, 1, 'the push stays offered')
  const none = draw(view({ forgePr: { ...pr, rest: [] } }))
  assert.equal(byAction(none.root, 'sendall-rest').length, 0)
})
