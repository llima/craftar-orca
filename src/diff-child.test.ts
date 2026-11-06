// A file's diff from the diff tool of a long-lived `craftar mcp` child (spec 60 §4, §6): started on the
// first diff, never with --fetch or --allow-writes, restarted once on PIN_CHANGED.
import { afterEach, assert, test } from 'orca/testing'
import { removeTempDirs } from '../test-support/tmp'
import { fixture, stubCraftar } from '../test-support/stub-craftar'
import { DiffChild, DiffRefused } from './diff-child'

const WS = '/home/acme/web'
const PATH = '.claude/rules/workflow.md'
const children: DiffChild[] = []

afterEach(async () => {
  for (const c of children.splice(0)) await c.stop()
  removeTempDirs()
})

const [INIT, DIFF] = fixture('mcp-diff.jsonl')
  .split('\n')
  .filter((l) => l !== '')
  .map((l) => JSON.parse(l).result)
const PIN =
  'the Forge or the profile of this workspace changed since craftar mcp started (forge, ref or profile in craftar.yaml / craftar.local.yaml) — restart the server to read the new one'
const toolError = (text: string) => ({ content: [{ type: 'text', text }], isError: true })

function child(table: Record<string, unknown>) {
  const s = stubCraftar({ 'mcp initialize': INIT, ...table })
  const c = new DiffChild({ bin: s.bin, env: s.env }, WS)
  children.push(c)
  return { s, c }
}

const spawned = (s: ReturnType<typeof stubCraftar>) => s.calls().filter((x) => x.argv[0] === 'mcp')

test('the exchange: initialize, initialized, then tools/call diff with the path; the diff comes back parsed', async () => {
  const { s, c } = child({ 'mcp call 0': DIFF })
  const r = await c.diff(PATH)
  assert.equal(r.files[0].path, PATH)
  assert.equal(r.files[0].state, 'update')
  assert.match(r.files[0].diff ?? '', /\+ Forge change\./)
  assert.deepEqual(
    s.requests().map((x) => x.request?.method),
    ['initialize', 'notifications/initialized', 'tools/call'],
  )
  assert.deepEqual(s.requests()[2].request?.params, { name: 'diff', arguments: { path: PATH } })
})

test('the child is started without --fetch and never with --allow-writes, and serves several diffs', async () => {
  const { s, c } = child({ 'mcp call 0': DIFF, 'mcp call 1': DIFF })
  await c.diff(PATH)
  await c.diff(PATH)
  assert.deepEqual(spawned(s).map((x) => x.argv), [['mcp', '--workspace', WS]])
})

test('nothing starts before the first diff', async () => {
  const { s } = child({})
  await new Promise((r) => setTimeout(r, 50))
  assert.equal(s.calls().length, 0)
})

test('PIN_CHANGED restarts the child once and retries; the second child is started the same way', async () => {
  const { s, c } = child({ 'mcp call 0': toolError(PIN), 'mcp call 1': DIFF })
  const r = await c.diff(PATH)
  assert.equal(r.files[0].path, PATH)
  const kids = spawned(s)
  assert.equal(kids.length, 2)
  assert.notEqual(kids[0].pid, kids[1].pid)
  assert.deepEqual(kids.map((x) => x.argv), [
    ['mcp', '--workspace', WS],
    ['mcp', '--workspace', WS],
  ])
})

test('PIN_CHANGED twice is a refusal in craftar words, after exactly one restart', async () => {
  const { s, c } = child({ 'mcp call 0': toolError(PIN), 'mcp call 1': toolError(PIN) })
  await assert.rejects(c.diff(PATH), (e: unknown) => e instanceof DiffRefused && (e as Error).message === PIN)
  assert.equal(spawned(s).length, 2)
})

test('another tool error is relayed verbatim, with no restart', async () => {
  const text = 'not produced by this workspace: .claude/rules/nothing.md'
  const { s, c } = child({ 'mcp call 0': toolError(text) })
  await assert.rejects(c.diff('.claude/rules/nothing.md'), (e: unknown) => e instanceof DiffRefused && (e as Error).message === text)
  assert.equal(spawned(s).length, 1)
})

test('stop ends the child; the next diff starts a fresh one', async () => {
  const { s, c } = child({ 'mcp call 0': DIFF, 'mcp call 1': DIFF })
  await c.diff(PATH)
  await c.stop()
  await c.diff(PATH)
  assert.equal(spawned(s).length, 2)
})
