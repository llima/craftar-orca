// The bell's levels, suggested fixes and Clear; × on every error card; Validate beside the bell (the user's requests of
// 2026-11-08). craftar's words stay as craftar wrote them; closing a card changes nothing craftar refused.
import { assert, test } from 'orca/testing'
import { all, byAction, click, fakeDocument, type FakeEl } from '../test-support/fake-dom'
import { fixture } from '../test-support/stub-craftar'
import { buildModel, type PanelModel } from './model'
import { render, type PanelView } from './panel-view'

const EDITED = '.claude/rules/commit-conventions.md'
const SKIP = 'agents-md: 1 skill ingredient(s) have no AGENTS.md equivalent — skipped: skill/x'

function view(edit: (m: PanelModel) => void = () => {}, over: Partial<PanelView> = {}): PanelView {
  const model = buildModel({
    ws: '/home/acme/web', name: 'web',
    status: JSON.parse(fixture('status.json')), drift: JSON.parse(fixture('drift-show.json')),
    repos: JSON.parse(fixture('repos.json')), registry: JSON.parse(fixture('workspaces.json')),
    fetchedAt: null, readAt: 0,
  })
  edit(model)
  return { focus: 'one', selfCheck: [], model, readFailed: false, ask: [], remote: [], probe: null, ...over }
}

function draw(v: PanelView, notice: string | null = null) {
  const doc = fakeDocument()
  const root = doc.createElement('main') as FakeEl
  const calls: string[] = []
  render(doc as never, root as never, v, {
    choose: () => undefined, refresh: () => undefined, showDiff: () => undefined,
    sendPreview: () => undefined, sendCancel: () => calls.push('cancel'),
    dismiss: (k) => calls.push(`dismiss ${k}`), messagesClear: () => calls.push('clear'), validate: () => calls.push('validate'),
    clearNotice: () => calls.push('notice'),
  }, null, notice)
  return { root, calls }
}
const role = (root: FakeEl, r: string): FakeEl[] => all(root).filter((e) => e.attrs['data-role'] === r)

test('each message carries its level and, apart from craftar\'s words, the fix; the badge counts what asks for the person', () => {
  const { root } = draw(view((m) => { m.warnings = [SKIP, 'plan: something to look at']; m.errors = [] }))
  const items = all(role(root, 'messages')[0]).filter((e) => e.tag === 'li')
  assert.deepEqual(items.map((e) => e.attrs['data-level']), ['action', 'action'])
  assert.deepEqual(role(root, 'warning').map((e) => e.textContent), [SKIP, 'plan: something to look at'])
  assert.match(role(root, 'message-fix')[0].textContent, /^fix: AGENTS\.md gets no skill file; this workspace also writes for claude-code/)
  assert.equal(role(root, 'messages-count')[0].textContent, '2')
})

test('Clear sends messages.clear; once cleared, no badge and no opening by itself, the messages still listed, dimmed', () => {
  const v = view((m) => { m.warnings = ['plan: a']; m.errors = ['drift show: failed'] })
  const before = draw(v)
  click(byAction(before.root, 'messages-clear')[0])
  assert.deepEqual(before.calls, ['clear'])
  const after = draw({ ...v, messagesCleared: true })
  assert.equal(role(after.root, 'messages-count').length, 0)
  assert.equal(role(after.root, 'messages')[0].attrs.class, 'pop')
  assert.equal(byAction(after.root, 'messages-clear').length, 0)
  assert.ok(role(after.root, 'messages-cleared').length === 1)
  assert.deepEqual(role(after.root, 'error').map((e) => e.textContent), ['drift show: failed'])
})

test('a cached copy adds the plugin\'s own information line with its age, never counted', () => {
  const { root } = draw(view((m) => { m.forge = { ...m.forge!, freshness: 'cached', fetchedAt: Date.now() - 5 * 60_000 }; m.warnings = []; m.errors = [] }))
  assert.match(role(root, 'plugin-line')[0].textContent, /cached copy of the Forge, fetched 5 min ago/)
  assert.equal(role(root, 'messages-count').length, 0)
})

test('× on the refusal card hides that card only: the file stays kept here, its words in the row and in the bell', () => {
  const message = 'error: D17: reaches agent/x, local to this profile'
  const v = view(() => {}, { sendRefused: [{ path: EDITED, message }] })
  const open = draw(v)
  const card = role(open.root, 'send-refused')[0]
  click(byAction(card, 'dismiss')[0])
  assert.equal(open.calls.length, 1)
  const key = open.calls[0].slice('dismiss '.length)
  assert.ok(key.includes(message))
  const closed = draw({ ...v, dismissed: [key] })
  assert.equal(role(closed.root, 'send-refused').length, 0)
  assert.match(closed.root.textContent, /kept here — craftar will not send it/)
  assert.equal(role(closed.root, 'send-refused-why')[0].attrs.title, message)
  assert.deepEqual(role(closed.root, 'error').map((e) => e.textContent), [`${EDITED}: ${message}`])
  assert.equal(byAction(closed.root, 'send-file').length, 0)
  // craftar saying something else is another card.
  const again = draw({ ...v, sendRefused: [{ path: EDITED, message: 'error: D16: other' }], dismissed: [key] })
  assert.equal(role(again.root, 'send-refused').length, 1)
})

test('every error card has a ×: the refused sync, a failed check, an unreachable Forge, a failed update, the self-check, the notice', () => {
  const refused = draw(view((m) => { m.refused = true; m.unset = [{ key: 'acme.team', declaredBy: ['rule/x'], citedBy: ['rule/x'] }] }))
  assert.equal(byAction(role(refused.root, 'refused')[0], 'dismiss').length, 1)
  const check = draw(view((m) => { m.checkFailed = true }))
  assert.equal(byAction(role(check.root, 'check-failed')[0], 'dismiss').length, 1)
  const cached = draw(view((m) => { m.forge = { ...m.forge!, freshness: 'cached' } }))
  assert.equal(byAction(role(cached.root, 'fetch-failed')[0], 'dismiss').length, 1)
  const sync = draw(view(() => {}, { sync: { phase: 'error', message: 'error: craftar mcp did not answer' } }))
  assert.equal(byAction(role(sync.root, 'sync-error')[0], 'dismiss').length, 1)
  const self = draw(view(() => {}, { selfCheck: [{ level: 'error', message: 'craftar 0.30.0 is older than 0.33.0' }] }))
  assert.equal(byAction(role(self.root, 'self-check')[0], 'dismiss').length, 1)
  const notice = draw(view(), 'the files changed — look again')
  click(byAction(notice.root, 'dismiss')[0])
  assert.deepEqual(notice.calls, ['notice'])
  const sendErr = draw(view(() => {}, { send: { path: EDITED, phase: 'error', plan: null, result: null, message: 'error: D16' } }))
  click(byAction(role(sendErr.root, 'send-box')[0], 'dismiss')[0])
  assert.deepEqual(sendErr.calls, ['cancel'])
})

test('Validate sits beside the bell, asks the worker, is busy while it runs, and its report is a closable card', () => {
  const idle = draw(view())
  const btns = all(idle.root).filter((e) => e.tag === 'button' && /icon-btn/.test(e.attrs.class ?? '')).map((e) => e.attrs['data-action'])
  assert.deepEqual(btns, ['messages', 'validate', 'refresh'])
  click(byAction(idle.root, 'validate')[0])
  assert.deepEqual(idle.calls, ['validate'])
  const busy = draw(view(() => {}, { validating: true }))
  assert.equal(byAction(busy.root, 'validate')[0].attrs['aria-busy'], 'true')
  assert.equal(byAction(busy.root, 'validate')[0].attrs.disabled, '')
  const probe = { at: 1, lines: ['self-check', '  ok    version 1.7.0', '', 'craftar probe — S0 (spec 60 §12)'] }
  const shown = draw(view(() => {}, { probe }))
  const card = role(shown.root, 'probe')[0]
  assert.match(role(card, 'probe-text')[0].textContent, /ok {4}version 1\.7\.0/)
  click(byAction(card, 'dismiss')[0])
  const key = shown.calls[0].slice('dismiss '.length)
  assert.equal(role(draw(view(() => {}, { probe, dismissed: [key] })).root, 'probe').length, 0)
  // Without a craftar workspace the report is shown too.
  assert.equal(role(draw(view(() => {}, { focus: 'none', model: null, probe })).root, 'probe').length, 1)
})

test("a refused path whose row craftar already says it will not promote keeps craftar's own reason, and no refusal card", () => {
  const v = view((m) => { m.edited = [{ path: '.kiro/steering/x.md', state: 'drift', promotable: false, reason: 'kiro file — edit its .claude/ twin' }] }, { sendRefused: [{ path: '.kiro/steering/x.md', message: 'error: D5' }] })
  const { root } = draw(v)
  assert.match(root.textContent, /kiro file — edit its \.claude\/ twin/)
  assert.doesNotMatch(root.textContent, /kept here — craftar will not send it/)
  assert.equal(role(root, 'send-refused').length, 0)
})

test('closing a refusal or failure card unlocks nothing: Bring stays off, the diagram still says it, craftar\'s words stay in the bell', () => {
  for (const [edit, card, flow] of [
    [(m: PanelModel) => { m.refused = true; m.unset = [{ key: 'acme.team', declaredBy: ['rule/x'], citedBy: ['rule/x'] }] }, 'refused', /sync refused/],
    [(m: PanelModel) => { m.checkFailed = true; m.errors = ['status: a check fails'] }, 'check-failed', /check failed/],
    [(m: PanelModel) => { m.forge = { ...m.forge!, freshness: 'cached' } }, 'fetch-failed', /could not fetch the Forge/],
  ] as [(m: PanelModel) => void, string, RegExp][]) {
    const v = view(edit, { update: { allowed: true, reason: null, files: [{ path: '.claude/rules/workflow.md', state: 'update' }] } })
    const open = draw(v)
    click(byAction(role(open.root, card)[0], 'dismiss')[0])
    const key = open.calls[0].slice('dismiss '.length)
    const closed = draw({ ...v, dismissed: [key] })
    assert.equal(role(closed.root, card).length, 0, card)
    assert.equal(byAction(closed.root, 'update')[0].attrs.disabled, '', card)
    assert.match(role(closed.root, 'sync-state')[0].textContent, flow)
  }
  const refused = view((m) => { m.refused = true; m.unset = [{ key: 'acme.team', declaredBy: ['rule/x'], citedBy: ['rule/x'] }] })
  assert.match(role(draw(refused).root, 'error')[0].textContent, /sync refused: declared parameter\(s\) with no value: acme\.team/)
})

test('the self-check\'s failures and a failed update are in the bell too, so closing their cards drops no word', () => {
  const v = view(() => {}, { selfCheck: [{ level: 'error', message: 'craftar 0.30.0 is older than 0.33.0' }], sync: { phase: 'error', message: 'error: craftar mcp did not answer' } })
  const errs = role(draw(v).root, 'error').map((e) => e.textContent)
  assert.ok(errs.includes('craftar 0.30.0 is older than 0.33.0'))
  assert.ok(errs.includes('error: craftar mcp did not answer'))
})

test('Clear is not offered when the only line is the plugin\'s own (a cached copy\'s age)', () => {
  const { root } = draw(view((m) => { m.forge = { ...m.forge!, freshness: 'cached', fetchedAt: Date.now() }; m.warnings = []; m.errors = [] }))
  assert.equal(role(root, 'plugin-line').length, 1)
  assert.equal(byAction(root, 'messages-clear').length, 0)
})
