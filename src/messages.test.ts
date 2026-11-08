// The bell's levels and suggested fixes: craftar's words kept, a fix a line of its own, offered only when it holds.
import { assert, test } from 'orca/testing'
import { cachedAgeLine, classify, counted } from './messages'

const SKIP = 'agents-md: 2 skill ingredient(s) have no AGENTS.md equivalent — skipped: skill/a, skill/b'

test('a skip another target covers is information, with the fix naming the target that writes it and how to silence it', () => {
  const m = classify(SKIP, false, ['agents-md', 'claude-code', 'kiro'])
  assert.equal(m.text, SKIP)
  assert.equal(m.level, 'info')
  assert.match(m.fix ?? '', /claude-code, kiro still write it/)
  assert.match(m.fix ?? '', /remove agents-md from the profile's targets/)
})

test('a skip no other target covers asks for the person, and never claims another target writes it', () => {
  const m = classify('kiro: hook hook/x has no Kiro equivalent — skipped', false, ['kiro'])
  assert.equal(m.level, 'action')
  assert.match(m.fix ?? '', /no target of this workspace writes it/)
})

test("a line that already says its fix gets none of the plugin's; an unknown line is kept as is, to look at", () => {
  const ignored = classify('.claude/rules/x.md is generated, but git ignores it (.gitignore:3: .claude/) — it will not reach a commit; fix the rule or git add -f', false, ['claude-code'])
  assert.equal(ignored.level, 'action')
  assert.equal(ignored.fix, undefined)
  const other = classify('something craftar says one day', false, [])
  assert.deepEqual(other, { text: 'something craftar says one day', level: 'action', from: 'craftar' })
})

test('an error stays an error; the cached copy is information with its age; the badge counts what asks for the person', () => {
  const e = classify('drift show: failed', true, [])
  assert.equal(e.level, 'error')
  const now = 10 * 60_000
  assert.deepEqual(cachedAgeLine(now - 7 * 60_000, now), { text: 'showing the cached copy of the Forge, fetched 7 min ago', level: 'info', from: 'plugin' })
  assert.match(cachedAgeLine(null, now).text, /never fetched/)
  assert.equal(counted([e, cachedAgeLine(null, now), classify(SKIP, false, ['claude-code'])]), 1)
})

test('a fetch that failed asks for the person; --offline is only information', () => {
  assert.equal(classify('Forge https://example.test/acme/forge.git not fetched (--offline) — using the cached copy at 7c41e0a, fetched never', false, []).level, 'info')
  const f = classify('Forge https://example.test/acme/forge.git not fetched (could not resolve host) — using the cached copy at 7c41e0a, fetched never', false, [])
  assert.equal(f.level, 'action')
  assert.match(f.fix ?? '', /Check again/)
})
