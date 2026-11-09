// Discard's pure part (spec 60 §8a): which rows, what is pending, a failed fetch, the argument array, the comparison after.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { afterDiscard, discardArgs, EXAMPLE_SETTINGS, fetchFailed, pendingOf, rowFault } from './discard'

const row = (path: string, state: string) => ({ path, state, target: 'claude-code', ingredient: 'rule/x', forge: 'same', promotable: true, reason: null })
const st = (rows: [string, string][], forge: Record<string, unknown> = { kind: 'path' }, warnings: string[] = []) => ({
  forge, statuses: rows.map(([path, state]) => ({ path, state, target: 'claude-code', ingredient: 'rule/x' })), warnings, unsetParams: [],
})

test('offered on a drift or an orphan-drift row only, never on the example settings file or a collision', () => {
  assert.equal(rowFault(row('.claude/rules/x.md', 'drift')), null)
  assert.equal(rowFault(row('.claude/rules/x.md', 'orphan-drift')), null)
  assert.ok(rowFault(row(EXAMPLE_SETTINGS, 'drift')))
  assert.ok(rowFault(row('.claude/rules/x.md', 'collision')))
  assert.ok(rowFault(undefined))
})

test('anything new, to update, adopt or remove is pending', () => {
  assert.deepEqual(pendingOf(st([['a', 'unchanged'], ['b', 'drift'], ['c', 'update'], ['d', 'new'], ['e', 'orphan'], ['f', 'adopt']]) as never), ['c', 'd', 'e', 'f'])
})

test("a failed fetch is a remote Forge read with fetched false, in craftar's words; a local Forge or a pinned SHA is none", () => {
  assert.equal(fetchFailed(st([], { kind: 'path' }) as never), null)
  assert.equal(fetchFailed(st([], { kind: 'git', fetched: true }) as never), null)
  assert.equal(fetchFailed(st([], { kind: 'git', fetched: false, ref: 'a'.repeat(40) }) as never), null)
  assert.deepEqual(fetchFailed(st([], { kind: 'git', fetched: false }, ['Forge https://x.example/f.git not fetched (no route) — using the cached copy', 'other']) as never), ['Forge https://x.example/f.git not fetched (no route) — using the cached copy'])
})

test('the child gets one path and --offline, never --overwrite-drift', () => {
  assert.deepEqual(discardArgs('.claude/rules/x.md', '/home/acme/web'), ['drift', 'discard', '.claude/rules/x.md', '--workspace', '/home/acme/web', '--offline'])
})

test('after the run: how the file reads, and every other row that moved', () => {
  const before = st([['x', 'drift'], ['y', 'unchanged'], ['z', 'drift']])
  const after = st([['x', 'unchanged'], ['y', 'update']])
  assert.deepEqual(afterDiscard(before as never, after as never, 'x'), { file: 'unchanged', others: ['y: unchanged → update', 'z: drift → not listed'] })
  assert.equal(afterDiscard(st([['x', 'orphan-drift']]) as never, st([]) as never, 'x').file, 'gone')
})
