// The one write of S2 (spec 60 §7 step 3, O2): a fresh `craftar mcp --workspace <abs> --allow-writes --fetch`
// child, one tools/call `sync` with no argument, then stopped. Never --overwrite-drift (the tool has none),
// never --offline. craftar's tool errors are classified by their fixed starts and relayed in their words.
import { afterEach, assert, test } from 'orca/testing'
import { removeTempDirs } from '../test-support/tmp'
import { fixture, stubCraftar } from '../test-support/stub-craftar'
import { syncOnce } from './sync-child'

afterEach(removeTempDirs)

const WS = '/home/acme/web'
const [INIT] = fixture('mcp-diff.jsonl')
  .split('\n')
  .filter((l) => l !== '')
  .map((l) => JSON.parse(l).result)
const toolError = (text: string) => ({ content: [{ type: 'text', text }], isError: true })
const RESULT = {
  profile: 'acme-web',
  recipes: ['base'],
  targets: ['claude-code'],
  forge: 'forge ../forge @ d2309dc',
  written: ['.claude/rules/workflow.md'],
  removed: [{ path: '.claude/rules/old.md', reason: 'orphan: no longer produced' }],
  skipped: [{ path: '.claude/rules/mine.md', state: 'drift', reason: 'edited by hand — kept' }],
  warnings: ['agents-md: the rule is long'],
  registry: 'updated',
}
const ok = { content: [{ type: 'text', text: JSON.stringify(RESULT) }], structuredContent: RESULT }

test('one child with exactly mcp --workspace <abs> --allow-writes --fetch, one sync call with no argument, then stopped', async () => {
  const s = stubCraftar({ 'mcp initialize': INIT, 'mcp call 0': ok })
  const r = await syncOnce({ bin: s.bin, env: s.env }, WS)
  assert.deepEqual(r, { kind: 'ok', result: RESULT })
  const mcp = s.calls().filter((c) => c.argv[0] === 'mcp')
  assert.equal(mcp.length, 1)
  assert.deepEqual(mcp[0].argv, ['mcp', '--workspace', WS, '--allow-writes', '--fetch'])
  const calls = s.requests().filter((c) => c.request?.method === 'tools/call')
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].request?.params, { name: 'sync', arguments: {} })
  assert.equal(s.requests().some((c) => c.argv.includes('--overwrite-drift') || c.argv.includes('--offline')), false)
})

test("craftar's consent and registry refusals are classified by their fixed starts and kept verbatim", async () => {
  const cases: [string, unknown][] = [
    ['writing is not allowed in this workspace — a person types craftar mcp allow-writes in it, in a terminal, to allow it', { kind: 'consent', reason: 'none' }],
    ['the write consent of this workspace was given for another ref, profile — a person types craftar mcp allow-writes again to allow the current one', { kind: 'consent', reason: 'stale' }],
    ['writing needs the registry, where the consent is recorded, and CRAFTAR_NO_REGISTRY is set for this server', { kind: 'registry' }],
    ['the registry, where the consent is recorded, does not read — run craftar doctor', { kind: 'registry' }],
    ['declared params with no value: acme.key — the sync is refused', { kind: 'error' }],
  ]
  for (const [text, want] of cases) {
    const s = stubCraftar({ 'mcp initialize': INIT, 'mcp call 0': toolError(text) })
    const r = await syncOnce({ bin: s.bin, env: s.env }, WS)
    assert.deepEqual(r, { ...(want as object), text })
  }
})

test('a child that does not start or answer is an error, never a write claimed', async () => {
  const r = await syncOnce({ bin: '/nonexistent/craftar', env: process.env }, WS)
  assert.equal(r.kind, 'error')
})

test('a relative workspace directory is refused before anything starts', async () => {
  await assert.rejects(syncOnce({ bin: '/nonexistent/craftar', env: process.env }, 'web'), /absolute/)
})
