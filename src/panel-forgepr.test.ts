// S3b in the panel: Prepare the PR after a Send; the preview (identity, branch, title, paths, body); one button per step, in
// order; Check the terminal after a wait; Back keeps the steps waiting on the workspace, with Continue and Drop.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { all, byAction, click, fakeDocument, type FakeEl } from '../test-support/fake-dom'
import { fixture } from '../test-support/stub-craftar'
import { buildModel } from './model'
import { render, type PanelView } from './panel-view'
import type { View } from './worker'

type Pr = NonNullable<View['forgePr']>
const PR: Pr = {
  open: true, phase: 'ready', step: null, waiting: false, forge: '/home/acme/forge', paths: ['ingredients/rules/x--acme/rule.md'],
  branch: 'craftar-acme-x', title: 'chore(forge): rule/x--acme from web', body: 'Sent from the workspace web.', identity: 'Acme Dev <dev@acme.example>',
  forgeBranch: 'main', authorDiffers: null, url: null, attached: null, steps: [], note: null,
}

function view(over: Partial<PanelView> = {}): PanelView {
  const model = buildModel({
    ws: '/home/acme/web', name: 'web', status: JSON.parse(fixture('status.json')), drift: JSON.parse(fixture('drift-show.json')),
    repos: JSON.parse(fixture('repos.json')), registry: JSON.parse(fixture('workspaces.json')), fetchedAt: null, readAt: 0,
  })
  return { focus: 'one', selfCheck: [], model, readFailed: false, ask: [], remote: [], probe: null, ...over }
}

function draw(v: PanelView, prDraft: { branch?: string; title?: string } | null = null) {
  const doc = fakeDocument()
  const root = doc.createElement('main') as FakeEl
  const calls: string[] = []
  render(doc as never, root as never, v, {
    choose: () => undefined, refresh: () => undefined, showDiff: () => undefined, sendCancel: () => calls.push('cancel'),
    forgePrPrepare: () => calls.push('prepare'), forgePrStep: (st, b, t) => calls.push(`step ${st}${b !== undefined ? ` ${b}` : ''}${t !== undefined ? ` | ${t}` : ''}`),
    forgePrCheck: () => calls.push('check'), forgePrShow: (o) => calls.push(`show ${o}`), forgePrDrop: () => calls.push('drop'),
  }, null, null, null, prDraft)
  return { root, calls }
}
const role = (root: FakeEl, r: string): FakeEl[] => all(root).filter((e) => e.attrs['data-role'] === r)
const actions = (root: FakeEl): string[] => all(role(root, 'toolbar')[0]).filter((e) => e.attrs['data-action']).map((e) => e.attrs['data-action'])

test("after Write to the Forge, the send's done screen offers Prepare the PR", () => {
  const plan = { dryRun: false, path: '.claude/rules/x.md', ingredient: 'rule/x', outcome: 'variant', promoted: 'rule/x--acme', written: [], params: [], sections: [], impact: { registry: 'read', workspaces: [] }, warnings: [] }
  const { root, calls } = draw(view({ send: { path: '.claude/rules/x.md', phase: 'done', plan: plan as never, result: plan as never, message: null } }))
  assert.deepEqual(actions(root), ['send-cancel', 'forgepr-prepare'])
  click(byAction(root, 'forgepr-prepare')[0])
  assert.deepEqual(calls, ['prepare'])
})

test('the preview shows the identity, the branch and title (editable), the exact paths and the body; the first button sends what is typed', () => {
  const { root, calls } = draw(view({ forgePr: PR }))
  assert.equal(role(root, 'forgepr-identity')[0].textContent, 'Acme Dev <dev@acme.example>')
  assert.equal(role(root, 'forgepr-from')[0].textContent, 'main')
  assert.equal(role(root, 'forgepr-branch')[0].value, 'craftar-acme-x')
  assert.equal(role(root, 'forgepr-title')[0].value, 'chore(forge): rule/x--acme from web')
  assert.deepEqual(role(root, 'forgepr-path').map((e) => e.textContent), ['ingredients/rules/x--acme/rule.md'])
  assert.equal(role(root, 'forgepr-body')[0].textContent, 'Sent from the workspace web.')
  assert.deepEqual(actions(root), ['forgepr-back', 'forgepr-commit'])
  role(root, 'forgepr-branch')[0].value = 'my-branch'
  click(byAction(root, 'forgepr-commit')[0])
  assert.deepEqual(calls, ['step commit my-branch | chore(forge): rule/x--acme from web'])
  // What was typed survives a redraw (panel.ts keeps the draft).
  assert.equal(role(draw(view({ forgePr: PR }), { title: 'typed' }).root, 'forgepr-title')[0].value, 'typed')
})

test('one button per step, in order: Push after the commit, Open the PR after the push; busy while one runs; nothing once open', () => {
  assert.deepEqual(actions(draw(view({ forgePr: { ...PR, phase: 'committed' } })).root), ['forgepr-back', 'forgepr-push'])
  assert.deepEqual(actions(draw(view({ forgePr: { ...PR, phase: 'pushed' } })).root), ['forgepr-back', 'forgepr-pr'])
  const busy = draw(view({ forgePr: { ...PR, phase: 'pushing', step: 'push' } })).root
  assert.deepEqual(actions(busy), ['forgepr-back'])
  assert.ok(all(role(busy, 'toolbar')[0]).some((e) => e.attrs['aria-busy'] === 'true'))
  const open = draw(view({ forgePr: { ...PR, phase: 'opened', url: 'https://github.com/acme/forge/pull/3', attached: true } })).root
  assert.deepEqual(actions(open), ['forgepr-back'])
  assert.match(role(open, 'forgepr-url')[0].textContent, /pull\/3 \(attached to this workspace\)/)
})

test('a failed step is tried again or dropped; a waiting terminal is read again; a different author is said', () => {
  const failed = draw(view({ forgePr: { ...PR, phase: 'failed', step: 'push', note: 'The push step failed: its terminal says why.' } }))
  assert.deepEqual(actions(failed.root), ['forgepr-back', 'forgepr-push', 'forgepr-drop'])
  click(byAction(failed.root, 'forgepr-push')[0])
  assert.deepEqual(failed.calls, ['step push'])
  const waiting = draw(view({ forgePr: { ...PR, phase: 'pushing', step: 'push', waiting: true } }))
  click(byAction(waiting.root, 'forgepr-check')[0])
  assert.deepEqual(waiting.calls, ['check'])
  assert.match(role(draw(view({ forgePr: { ...PR, phase: 'committed', authorDiffers: 'Other <o@acme.example>' } })).root, 'forgepr-author')[0].textContent, /made as Other/)
})

test('Back keeps the steps: the workspace shows a card with Continue and Drop', () => {
  const back = draw(view({ forgePr: PR }))
  click(byAction(back.root, 'forgepr-back')[0])
  assert.deepEqual(back.calls, ['show false'])
  const main = draw(view({ forgePr: { ...PR, open: false, phase: 'committed' } }))
  assert.equal(role(main.root, 'forgepr-waiting').length, 1)
  click(byAction(main.root, 'forgepr-show')[0])
  click(byAction(main.root, 'forgepr-drop')[0])
  assert.deepEqual(main.calls, ['show true', 'drop'])
})

test('in words, when no terminal can be opened', () => {
  const { root } = draw(view({ forgePr: { ...PR, phase: 'words', steps: ['No terminal was opened.', 'Push the branch.'] } }))
  assert.deepEqual(role(root, 'forgepr-word').map((e) => e.textContent), ['No terminal was opened.', 'Push the branch.'])
  assert.deepEqual(actions(root), ['forgepr-back', 'forgepr-drop'])
})
