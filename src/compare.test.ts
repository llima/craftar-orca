// The sync's result against the question it answered (spec 60 §7 step 3): the `sync` tool has no digest, so
// what it did is compared with the pending set the person agreed to, and every difference is shown.
import { assert, test } from 'orca/testing'
import { compareWithQuestion } from './compare'

const asked = [
  { path: '.claude/rules/a.md', state: 'update' },
  { path: '.claude/rules/b.md', state: 'new' },
  { path: '.claude/rules/old.md', state: 'orphan' },
]
const base = { written: ['.claude/rules/a.md', '.claude/rules/b.md'], removed: [{ path: '.claude/rules/old.md', reason: 'orphan' }], skipped: [] as { path: string; state: string; reason: string }[] }

test('a result that did exactly what was asked has no difference and needs no re-run', () => {
  assert.deepEqual(compareWithQuestion(asked, base), { differences: [], rerun: false })
})

test('a path written or removed that was not asked, and an asked path neither done nor kept, are differences', () => {
  const r = compareWithQuestion(asked, { written: ['.claude/rules/a.md', '.claude/rules/c.md'], removed: [], skipped: [] })
  assert.deepEqual(r.differences, [
    'written but not in the list you agreed to: .claude/rules/c.md',
    'in the list you agreed to but not written, removed or kept: .claude/rules/b.md',
    'in the list you agreed to but not written, removed or kept: .claude/rules/old.md',
  ])
  assert.equal(r.rerun, false)
})

test('a removal that was not asked is a difference; an asked path kept by craftar is not', () => {
  const r = compareWithQuestion(asked, {
    written: ['.claude/rules/a.md'],
    removed: [{ path: '.claude/rules/old.md', reason: 'orphan' }, { path: '.claude/rules/z.md', reason: 'orphan' }],
    skipped: [{ path: '.claude/rules/b.md', state: 'collision', reason: 'not written by craftar — kept' }],
  })
  assert.deepEqual(r.differences, ['removed but not in the list you agreed to: .claude/rules/z.md'])
})

test("a file kept as changed while craftar was writing asks for a re-run", () => {
  const r = compareWithQuestion(asked, { ...base, skipped: [{ path: '.claude/rules/x.md', state: 'drift', reason: 'changed while craftar was writing — kept; run craftar sync again' }] })
  assert.equal(r.rerun, true)
})
