// P1 (the install test of 2026-11-09): when craftar is missing, does not start or is too old, the panel says so
// first, plainly, with the README's install line, and the card cannot be closed.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { all, byAction, click, fakeDocument, type FakeEl } from '../test-support/fake-dom'
import type { Line } from './self-check'
import { render } from './panel-view'
import type { View } from './worker'

function view(selfCheck: Line[], over: Partial<View> = {}): View {
  return { focus: 'none', selfCheck, model: null, readFailed: false, ask: [], remote: [], probe: null, update: null, sync: null, consent: null, lastSync: null, ...over } as View
}

function draw(v: View) {
  const doc = fakeDocument()
  const root = doc.createElement('main') as FakeEl
  const calls: string[] = []
  render(doc as never, root as never, v, {
    choose: () => undefined,
    refresh: () => calls.push('refresh'),
    showDiff: () => undefined,
    validate: () => calls.push('validate'),
    dismiss: (k: string) => calls.push(`dismiss ${k}`),
  } as never, null)
  return { root, calls }
}

const role = (root: FakeEl, r: string): FakeEl[] => all(root).filter((e) => e.attrs['data-role'] === r)

const MISSING: Line = { level: 'error', message: 'craftar: craftar not found on the absolute entries of PATH (set craftarPath)', install: 'missing' }

test('craftar not found: the install card comes first in the body, with npm install -g craftar, and no craftar init', () => {
  const { root } = draw(view([MISSING]))
  const card = role(root, 'install')
  assert.equal(card.length, 1)
  const body = all(root).find((e) => e.attrs.class === 'body')
  assert.ok(body)
  assert.equal(body.children[0], card[0], 'the install card is the first thing in the body')
  assert.match(card[0].textContent, /npm install -g craftar/)
  assert.match(card[0].textContent, /not found on the absolute entries of PATH/)
  assert.match(card[0].textContent, /craftar binary/)
  assert.doesNotMatch(root.textContent, /craftar init/)
})

test('the install card has no close button, and the Self-check card does not repeat its line', () => {
  const { root } = draw(view([MISSING]))
  const card = role(root, 'install')[0]
  assert.equal(all(card).some((e) => (e.attrs['aria-label'] ?? '').startsWith('Close')), false)
  assert.equal(role(root, 'self-check').length, 0)
})

test('Check again on the install card runs the self-check again (Validate)', () => {
  const { root, calls } = draw(view([MISSING]))
  const again = byAction(role(root, 'install')[0], 'install-check')
  assert.equal(again.length, 1)
  click(again[0])
  assert.deepEqual(calls, ['validate'])
})

test('a craftar that does not start says Node must be on the PATH too; one too old says to upgrade', () => {
  const broken = draw(view([{ level: 'error', message: 'craftar --version did not run (exit 127): craftar is installed but does not start', install: 'broken' }])).root
  assert.match(role(broken, 'install')[0].textContent, /does not start/)
  assert.match(role(broken, 'install')[0].textContent, /Node 22/)
  const old = draw(view([{ level: 'error', message: 'craftar 0.30.0 is older than 0.33.0, the oldest with every surface this plugin reads: upgrade craftar', install: 'old' }])).root
  assert.match(role(old, 'install')[0].textContent, /npm install -g craftar/)
  assert.match(role(old, 'install')[0].textContent, /0\.30\.0 is older/)
})

test('a self-check error that is not about installing (a doctor error) draws no install card', () => {
  const { root } = draw(view([{ level: 'error', message: 'doctor params: acme.key is declared and has no value' }]))
  assert.equal(role(root, 'install').length, 0)
  assert.equal(role(root, 'self-check').length, 1)
})
