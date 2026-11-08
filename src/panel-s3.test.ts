// S3a in the approved panel (spec 60 §8, O5, O7): Send to Forge asks for the dry run, shows craftar's plan as
// text, and writes only on a second click; a URL Forge asks for a local clone first; a saved file is marked.
import { assert, test } from 'orca/testing'
import { all, byAction, click, fakeDocument, type FakeEl } from '../test-support/fake-dom'
import { fixture } from '../test-support/stub-craftar'
import { buildModel } from './model'
import { render } from './panel-view'
import type { View } from './worker'

const EDITED = '.claude/rules/commit-conventions.md'

function view(over: Partial<View> = {}): View {
  const model = buildModel({
    ws: '/home/acme/web', name: 'web',
    status: JSON.parse(fixture('status.json')), drift: JSON.parse(fixture('drift-show.json')),
    repos: JSON.parse(fixture('repos.json')), registry: JSON.parse(fixture('workspaces.json')),
    fetchedAt: null, readAt: 0,
  })
  return {
    focus: 'one', selfCheck: [], model, readFailed: false, ask: [], remote: [], probe: null,
    update: { allowed: false, reason: 'nothing to update', files: [] }, sync: { phase: 'idle', message: null }, consent: null, lastSync: null,
    send: null, forgeDir: { needed: false, dir: null }, marked: [], ...over,
  }
}

function draw(v: View) {
  const doc = fakeDocument()
  const root = doc.createElement('main') as FakeEl
  const calls: string[] = []
  render(doc as never, root as never, v, {
    choose: () => undefined, refresh: () => undefined, showDiff: () => undefined,
    sendPreview: (p) => calls.push(`preview ${p}`), sendRun: (p) => calls.push(`run ${p}`), sendCancel: () => calls.push('cancel'),
    forgeDirSet: (d) => calls.push(`dir ${d}`),
  })
  return { root, calls }
}

const PLAN = {
  workspace: '/home/acme/web', forge: '/home/acme/forge2', profile: 'acme-web', dryRun: true, path: EDITED, ingredient: 'rule/commit-conventions',
  outcome: 'variant', promoted: 'rule/commit-conventions--acme-web', written: [{ path: 'ingredients/rules/commit-conventions--acme-web/rule.md', action: 'created' }],
  params: [{ key: 'acme.team', old: 'web', value: '<b>platform</b>' }], sections: [], flattened: { params: [], sections: [] }, dependents: [], nextSync: { counts: { unchanged: 4 } },
  impact: { registry: 'read', workspaces: [{ path: '/home/acme/api' }] }, warnings: ['a warning in craftar words'],
}

test('Send to Forge asks for the dry run of the first file craftar can send', () => {
  const { root, calls } = draw(view())
  const b = byAction(root, 'send')[0]
  assert.equal(b.attrs.disabled, undefined)
  click(b)
  assert.deepEqual(calls, [`preview ${EDITED}`])
})

test("the plan is drawn as text — outcome, files, values, workspaces, craftar's warnings — and only the second click writes", () => {
  const { root, calls } = draw(view({ send: { path: EDITED, phase: 'preview', plan: PLAN as never, result: null, message: null } }))
  const text = root.textContent
  assert.match(text, /variant/)
  assert.match(text, /ingredients\/rules\/commit-conventions--acme-web\/rule\.md/)
  assert.match(text, /acme\.team/)
  assert.match(text, /a warning in craftar words/)
  assert.equal(all(root).some((e) => e.tag === 'b'), false)
  click(byAction(root, 'send-confirm')[0])
  click(byAction(root, 'send-cancel')[0])
  assert.deepEqual(calls, [`run ${EDITED}`, 'cancel'])
})

test("after the write: what craftar wrote, and that nothing was committed; a refusal is craftar's words", () => {
  const done = draw(view({ send: { path: EDITED, phase: 'done', plan: PLAN as never, result: { ...PLAN, dryRun: false } as never, message: null } }))
  assert.match(done.root.textContent, /nothing was committed/)
  const err = draw(view({ send: { path: EDITED, phase: 'error', plan: null, result: null, message: 'error: D16: promote refused' } }))
  assert.match(err.root.textContent, /error: D16: promote refused/)
})

test('a URL Forge with no clone named: Send is off and the panel asks for the clone folder', () => {
  const { root, calls } = draw(view({ forgeDir: { needed: true, dir: null } }))
  assert.equal(byAction(root, 'send')[0].attrs.disabled, '')
  // The ask sits in the fixed footer toolbar, above the buttons, not in the body.
  const bar = all(root).find((e) => e.attrs['data-role'] === 'toolbar')!
  assert.ok(all(bar).some((e) => e.attrs['data-role'] === 'forge-dir'))
  assert.ok(all(bar).some((e) => e.attrs['data-action'] === 'forge-dir-save'))
  assert.equal(all(bar).filter((e) => e.attrs['data-role'] === 'send-reason').length, 0)
  const input = all(bar).find((e) => e.attrs['data-role'] === 'forge-dir-input')
  assert.ok(input)
  input!.value = '/home/acme/forge-clone'
  click(byAction(root, 'forge-dir-save')[0])
  assert.deepEqual(calls, ['dir /home/acme/forge-clone'])
})

test('a file the save hook marked reads as edited — not yet in the Forge', () => {
  const { root } = draw(view({ marked: ['.claude/rules/workflow.md'] }))
  const m = all(root).filter((e) => e.attrs['data-role'] === 'marked').map((e) => e.textContent)
  assert.deepEqual(m, ['.claude/rules/workflow.md — edited, not yet in the Forge'])
})

test("the plan also lists what craftar flattens and depends on, and this workspace's next sync", () => {
  const plan = { ...PLAN, flattened: { params: ['acme.team'], sections: ['rule/commit-conventions#intro'] }, dependents: [{ ref: 'agent/reviewer' }], nextSync: { counts: { unchanged: 4, update: 1 } } }
  const { root } = draw(view({ send: { path: EDITED, phase: 'preview', plan: plan as never, result: null, message: null } }))
  const text = root.textContent
  assert.match(text, /section rule\/commit-conventions#intro/)
  assert.match(text, /param acme\.team/)
  assert.match(text, /agent\/reviewer/)
  assert.match(text, /unchanged 4/)
})

test("craftar's own dry-run shape draws the plan and the Write button", () => {
  // As `craftar drift promote --dry-run --json` printed it in the live run: `flattened` is an object, `dependents` paths.
  const plan = { ...PLAN, outcome: 'variant', flattened: { params: [], sections: [] }, dependents: ['/home/acme/other'], nextSync: { counts: {} } }
  const { root } = draw(view({ send: { path: EDITED, phase: 'preview', plan: plan as never, result: null, message: null } }))
  assert.equal(byAction(root, 'send-confirm').length, 1)
  assert.match(root.textContent, /\/home\/acme\/other/)
})

test('a stored clone folder is shown with a way to change it', () => {
  const { root, calls } = draw(view({ forgeDir: { needed: true, dir: '/home/acme/forge-clone' } }))
  assert.match(root.textContent, /\/home\/acme\/forge-clone/)
  const bar = all(root).find((e) => e.attrs['data-role'] === 'toolbar')!
  assert.ok(all(bar).some((e) => e.attrs['data-role'] === 'forge-dir-stored'))
  click(byAction(root, 'forge-dir-change')[0])
  assert.deepEqual(calls, ['dir '])
})

test('the send screen takes the body over: its steps, and its own toolbar per phase', () => {
  const role = (root: FakeEl, r: string) => all(root).filter((e) => e.attrs['data-role'] === r)
  const bar = (root: FakeEl) => all(role(root, 'toolbar')[0]).filter((e) => e.attrs['data-action']).map((e) => e.attrs['data-action'])
  const preview = draw(view({ send: { path: EDITED, phase: 'preview', plan: PLAN as never, result: null, message: null } }))
  assert.deepEqual(bar(preview.root), ['send-cancel', 'send-confirm'])
  assert.match(role(preview.root, 'send-steps')[0].textContent, /1 dry run2 write3 done/)
  assert.equal(role(preview.root, 'list-down').length, 0)
  click(byAction(preview.root, 'send-confirm')[0])
  assert.deepEqual(preview.calls, [`run ${EDITED}`])
  const writing = draw(view({ send: { path: EDITED, phase: 'writing', plan: PLAN as never, result: null, message: null } }))
  const busy = all(role(writing.root, 'toolbar')[0]).find((e) => e.attrs['aria-busy'] === 'true')
  assert.equal(busy?.attrs.disabled, '')
  assert.equal(byAction(writing.root, 'send-confirm').length, 0)
  const done = draw(view({ send: { path: EDITED, phase: 'done', plan: PLAN as never, result: { ...PLAN, dryRun: false } as never, message: null } }))
  assert.deepEqual(bar(done.root), ['send-cancel'])
  click(byAction(done.root, 'send-cancel')[0])
  assert.deepEqual(done.calls, ['cancel'])
})
