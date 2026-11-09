// Send to Forge (spec 60 §8 step 3, O5): `craftar drift promote <path> --workspace <abs> [--forge <dir>]
// [--dry-run] --json` as an argument array — the dry run first, the write on a second click. craftar proves
// the change, writes the Forge's working tree and never commits; its refusal is shown in its words.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { afterEach } from 'orca/testing'
import { removeTempDirs } from '../test-support/tmp'
import { stubCraftar } from '../test-support/stub-craftar'
import { promote, PromoteRefused } from './promote'

afterEach(removeTempDirs)

const WS = '/home/acme/web'
const PLAN = {
  workspace: WS, forge: '/home/acme/forge', profile: 'acme-web', dryRun: true, path: '.claude/rules/workflow.md',
  ingredient: 'rule/workflow', outcome: 'variant', promoted: 'rule/workflow--acme-web',
  written: [{ path: 'ingredients/rules/workflow--acme-web/rule.md', action: 'created' }],
  params: [], sections: [], flattened: { params: [], sections: [] }, dependents: [], nextSync: { counts: { unchanged: 3 } },
  impact: { registry: 'read', workspaces: [] }, warnings: ['a warning in craftar words'],
}

test('the dry run: exactly drift promote <path> --workspace <abs> --dry-run --json, the plan read back', async () => {
  const s = stubCraftar({ 'drift promote': { stdout: JSON.stringify(PLAN), code: 0 } })
  const r = await promote({ bin: s.bin, env: s.env }, WS, '.claude/rules/workflow.md', { dryRun: true, forge: null })
  assert.equal(r.outcome, 'variant')
  assert.deepEqual(r.written, PLAN.written)
  assert.deepEqual(s.calls()[0].argv, ['drift', 'promote', '.claude/rules/workflow.md', '--workspace', WS, '--dry-run', '--json'])
})

test('the write passes no --dry-run, and a Forge directory as --forge when one is named', async () => {
  const s = stubCraftar({ 'drift promote': { stdout: JSON.stringify({ ...PLAN, dryRun: false }), code: 0 } })
  await promote({ bin: s.bin, env: s.env }, WS, '.claude/rules/workflow.md', { dryRun: false, forge: '/home/acme/forge-clone' })
  assert.deepEqual(s.calls()[0].argv, ['drift', 'promote', '.claude/rules/workflow.md', '--workspace', WS, '--forge', '/home/acme/forge-clone', '--json'])
})

test("a refusal is craftar's words from stderr, and no document is a failure that names its exit only", async () => {
  const s = stubCraftar({ 'drift promote': { stdout: '', code: 1, stderr: 'error: D16: another profile resolves rule/workflow — promote refused\n' } })
  await assert.rejects(promote({ bin: s.bin, env: s.env }, WS, '.claude/rules/workflow.md', { dryRun: true, forge: null }), (e: unknown) => {
    assert.ok(e instanceof PromoteRefused)
    assert.equal((e as Error).message, 'error: D16: another profile resolves rule/workflow — promote refused')
    return true
  })
})

test('a path that starts with a dash or is absolute is refused before anything starts', async () => {
  const s = stubCraftar({})
  await assert.rejects(promote({ bin: s.bin, env: s.env }, WS, '-n', { dryRun: true, forge: null }), /not a workspace path/)
  await assert.rejects(promote({ bin: s.bin, env: s.env }, WS, '/etc/passwd', { dryRun: true, forge: null }), /not a workspace path/)
  assert.equal(s.calls().length, 0)
})

test('a write that does not finish says the Forge may be partly written', async () => {
  const s = stubCraftar({ 'drift promote': { stdout: '', code: 0, delayMs: 2000 } })
  await assert.rejects(
    promote({ bin: s.bin, env: s.env }, WS, '.claude/rules/workflow.md', { dryRun: false, forge: null, timeoutMs: 300 }),
    /may be partly written: look at git status in the Forge/,
  )
})
