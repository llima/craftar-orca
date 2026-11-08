// Discard in the worker (spec 60 §8a): the confirmation with the diff; Update first with anything pending; the second read fetches,
// a failed fetch or a pending row cancels, a moved Forge draws the confirmation again; the child's arguments; a refusal relayed
// as craftar words it; the re-read after; nothing staged; the periodic check holds that Forge's fetches during the run.
import { afterEach, assert, beforeEach, mockHost, mountWorker, test } from 'orca/testing'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { removeTempDirs, tempDir } from '../test-support/tmp'
import { fixture, stubCraftar } from '../test-support/stub-craftar'
import * as main from './worker'
import type { View } from './worker'

const CAPS = ['workspace:read', 'workspace:write', 'terminal:send', 'terminal:read', 'notifications:show', 'storage:own', 'settings:own']
const workers: { deactivate: () => Promise<void> | void }[] = []
let savedPath: string | undefined
beforeEach(() => {
  savedPath = process.env.PATH
  process.env.PATH = tempDir('craftar-orca-path-')
})
afterEach(async () => {
  for (const w of workers.splice(0)) await w.deactivate()
  process.env.PATH = savedPath
  removeTempDirs()
})

const EDITED = '.claude/rules/commit-conventions.md'
const INIT = JSON.parse(fixture('mcp-diff.jsonl').split('\n')[0]).result

/** status with nothing pending (the fixture's workflow.md update made unchanged), optionally remote and with a commit. */
function statusDoc(over: { pending?: boolean; forge?: Record<string, unknown>; warnings?: string[] } = {}) {
  const d = JSON.parse(fixture('status.json'))
  for (const r of d.statuses) if (r.state === 'update' && !over.pending) r.state = 'unchanged'
  if (over.forge) d.forge = { ...d.forge, ...over.forge }
  if (over.warnings) d.warnings = over.warnings
  return { stdout: JSON.stringify(d), code: 0 }
}
function driftDoc(forgeSide = 'same') {
  const d = JSON.parse(fixture('drift-show.json'))
  d.files[0].forge = forgeSide
  return { stdout: JSON.stringify(d), code: 1 }
}
const diffAnswer = (diff: string | null, note: string | null = null) => ({ content: [{ type: 'text', text: JSON.stringify({ files: [{ path: EDITED, state: 'drift', added: 1, removed: 1, diff, note }], warnings: [], unsetParams: [] }) }] })

async function setup(extra: Record<string, unknown> = {}) {
  const s = stubCraftar({
    'doctor --json': { stdout: fixture('doctor.json'), code: 0 },
    'workspaces --json': { stdout: fixture('workspaces.json'), code: 0 },
    'status --json': statusDoc(),
    'status --json --offline': statusDoc(),
    'drift show --json': driftDoc(),
    'repos --json': { stdout: fixture('repos.json'), code: 0 },
    'mcp initialize': INIT,
    'mcp call 0': diffAnswer('- my edit\n+ what craftar writes'),
    // The confirmation's diff, the second read's (the same: nothing moved), and the one a redrawn confirmation shows.
    'mcp call 1': diffAnswer('- my edit\n+ what craftar writes'),
    'mcp call 2': diffAnswer('- my edit\n+ the new text'),
    'drift discard': { stdout: 'wrote .claude/rules/commit-conventions.md\n', code: 0 },
    ...extra,
  })
  const web = tempDir('craftar-orca-ws-')
  writeFileSync(join(web, 'craftar.yaml'), 'forge: ../forge\nprofile: acme-web\n')
  const h = mockHost({
    capabilities: CAPS,
    settings: { craftarPath: s.bin, craftarHome: '', intervalMinutes: 5, fetch: true },
    results: {
      'workspace.list': { workspaces: [{ id: 'w1', kind: 'folder', name: 'web', path: web, branch: 'main', hostId: 'local' }], truncated: false },
      'workspace.readContext': { branch: 'main', displayName: 'web', terminals: [] },
    },
  })
  const saved = { NODE_OPTIONS: process.env.NODE_OPTIONS, CRAFTAR_STUB_LOG: process.env.CRAFTAR_STUB_LOG, CRAFTAR_STUB_TABLE: process.env.CRAFTAR_STUB_TABLE }
  Object.assign(process.env, { NODE_OPTIONS: s.env.NODE_OPTIONS, CRAFTAR_STUB_LOG: s.env.CRAFTAR_STUB_LOG, CRAFTAR_STUB_TABLE: s.env.CRAFTAR_STUB_TABLE })
  const worker = await mountWorker(main, { host: h, commands: ['craftar.probe', 'craftar.open'], events: ['workspace.changed'], hooks: ['editor.save.before'] })
  workers.push({
    deactivate: async () => {
      await worker.deactivate()
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k]
        else process.env[k] = v
      }
    },
  })
  await main.settled()
  const answer = (key: string, value: unknown) => {
    const t = JSON.parse(readFileSync(s.env.CRAFTAR_STUB_TABLE, 'utf8'))
    t[key] = value
    writeFileSync(s.env.CRAFTAR_STUB_TABLE, JSON.stringify(t))
  }
  return { s, h, worker, web, answer }
}

const state = async (worker: { request: (n: string) => Promise<unknown> }) => ((await worker.request('state.get')) as View).discard
const discards = (s: { calls: () => { argv: string[] }[] }) => s.calls().filter((c) => c.argv[0] === 'drift' && c.argv[1] === 'discard').map((c) => c.argv)

test('the confirmation names the file with its diff; the second click fetches, then discards that one path --offline; nothing staged', async () => {
  const { s, h, worker, web, answer } = await setup()
  await worker.request('discard.open', { path: EDITED })
  let d = await state(worker)
  assert.equal(d?.phase, 'confirm')
  assert.equal(d?.diff, '- my edit\n+ what craftar writes')
  assert.equal(discards(s).length, 0)
  await worker.request('discard.run', { path: EDITED })
  // The read after the run sees the file as craftar writes it (the second read, which fetches, keeps its own answer).
  const put = JSON.parse(statusDoc().stdout)
  for (const r of put.statuses) if (r.path === EDITED) r.state = 'unchanged'
  answer('status --json --offline', { stdout: JSON.stringify(put), code: 0 })
  await main.settled()
  d = await state(worker)
  assert.equal(d?.phase, 'done')
  assert.deepEqual(discards(s), [['drift', 'discard', EDITED, '--workspace', web, '--offline']])
  // The second read fetched: a status with no --offline came right before the discard.
  const kinds = s.calls().map((c) => c.argv.join(' '))
  const at = kinds.findIndex((k) => k.startsWith('drift discard'))
  assert.ok(kinds.slice(0, at).some((k) => k.startsWith('status --json --workspace')))
  assert.equal(s.calls().some((c) => c.argv.includes('--overwrite-drift')), false)
  // The re-read after the run, its comparison, and craftar's report kept.
  const afterRun = kinds.slice(at + 1)
  assert.ok(afterRun.some((k) => k.startsWith('status --json --offline')) && afterRun.some((k) => k.startsWith('drift show')))
  assert.equal(d?.after?.file, 'unchanged')
  assert.equal(d?.after?.report, 'wrote .claude/rules/commit-conventions.md')
  // Nothing staged: no git was started and the source control view was not opened.
  assert.equal(h.callsOf('commands.run').filter((c) => (c as { action: string }).action === 'sidebar.sourceControl.toggle').length, 0)
})

test('Update first: with anything pending, no confirmation', async () => {
  const { worker } = await setup({ 'status --json --offline': statusDoc({ pending: true }) })
  await assert.rejects(worker.request('discard.open', { path: EDITED }), /Update first/)
})

test('a pending row found by the second read cancels the run, writing nothing', async () => {
  const late = await setup()
  await late.worker.request('discard.open', { path: EDITED })
  late.answer('status --json', statusDoc({ pending: true }))
  await late.worker.request('discard.run', { path: EDITED })
  await main.settled()
  const d = await state(late.worker)
  assert.equal(d?.phase, 'error')
  assert.match(d?.message ?? '', /Nothing was written.*Update first/)
  assert.equal(discards(late.s).length, 0)
})

test("a failed fetch on the second read cancels, in craftar's words", async () => {
  const remote = { kind: 'git', source: 'https://x.example/acme/forge.git', fetched: false }
  const { s, worker, answer } = await setup({ 'status --json --offline': statusDoc({ forge: remote }) })
  await worker.request('discard.open', { path: EDITED })
  answer('status --json', statusDoc({ forge: remote, warnings: ['Forge https://x.example/acme/forge.git not fetched (no route) — using the cached copy'] }))
  await worker.request('discard.run', { path: EDITED })
  await main.settled()
  const d = await state(worker)
  assert.equal(d?.phase, 'error')
  assert.match(d?.message ?? '', /not fetched \(no route\)/)
  assert.equal(discards(s).length, 0)
})

test('a Forge that moved since the confirmation draws it again on the new diff, writing nothing', async () => {
  const { s, worker, answer } = await setup()
  await worker.request('discard.open', { path: EDITED })
  answer('status --json', statusDoc({ forge: { commit: 'f'.repeat(40) } }))
  answer('status --json --offline', statusDoc({ forge: { commit: 'f'.repeat(40) } }))
  await worker.request('discard.run', { path: EDITED })
  await main.settled()
  const d = await state(worker)
  assert.equal(d?.phase, 'confirm')
  assert.match(d?.message ?? '', /Forge moved/)
  assert.equal(d?.diff, '- my edit\n+ the new text')
  assert.equal(discards(s).length, 0)
})

test("craftar's refusal is relayed as it words it, stderr and stdout, with no retry", async () => {
  const { s, worker } = await setup({ 'drift discard': { stdout: 'warning: a plan warning\n', stderr: 'error: not drifted: .claude/rules/commit-conventions.md (unchanged)\n', code: 1 } })
  await worker.request('discard.open', { path: EDITED })
  await worker.request('discard.run', { path: EDITED })
  await main.settled()
  const d = await state(worker)
  assert.equal(d?.phase, 'error')
  assert.equal(d?.message, 'error: not drifted: .claude/rules/commit-conventions.md (unchanged)\nwarning: a plan warning')
  assert.equal(discards(s).length, 1)
})

test('the example settings file is not offered', async () => {
  const { worker } = await setup()
  await assert.rejects(worker.request('discard.open', { path: '.claude/settings.craftar.example.json' }), /not a file craftar lists|typed/)
})

test('a withheld file the Forge changed too is not offered', async () => {
  const { worker } = await setup({ 'drift show --json': driftDoc('changed'), 'mcp call 0': diffAnswer(null, 'content not shown: an MCP file') })
  await assert.rejects(worker.request('discard.open', { path: EDITED }), /Forge changed it too/)
})

test('a second click while the discard runs starts nothing', async () => {
  const busy = await setup({ 'drift discard': { stdout: '', code: 0, delayMs: 300 } })
  await busy.worker.request('discard.open', { path: EDITED })
  await busy.worker.request('discard.run', { path: EDITED })
  await assert.rejects(busy.worker.request('discard.run', { path: EDITED }), /look at the confirmation first|already running/)
  await main.settled()
  assert.equal(discards(busy.s).length, 1)
})

test("on a path Forge whose HEAD did not move, a changed diff draws the confirmation again", async () => {
  // mcp call 0 is the confirmation's diff, mcp call 1 the second read's: they differ, with the same HEAD.
  const { s, worker } = await setup({ 'mcp call 1': diffAnswer('- my edit\n+ the new text') })
  await worker.request('discard.open', { path: EDITED })
  await worker.request('discard.run', { path: EDITED })
  await main.settled()
  const d = await state(worker)
  assert.equal(d?.phase, 'confirm')
  assert.match(d?.message ?? '', /Forge moved/)
  assert.equal(discards(s).length, 0)
})

test('a ref that is a full commit SHA, not fetched again, still runs', async () => {
  const pinned = { kind: 'git', source: 'https://x.example/acme/forge.git', fetched: false, ref: 'a'.repeat(40) }
  const { s, worker } = await setup({ 'status --json': statusDoc({ forge: pinned }), 'status --json --offline': statusDoc({ forge: pinned }) })
  await worker.request('discard.open', { path: EDITED })
  await worker.request('discard.run', { path: EDITED })
  await main.settled()
  assert.equal((await state(worker))?.phase, 'done')
  assert.equal(discards(s).length, 1)
})

test("the periodic check holds that Forge's fetches while the discard reads and runs", async () => {
  const { s, worker } = await setup({ 'drift discard': { stdout: '', code: 0, delayMs: 400 } })
  await worker.request('discard.open', { path: EDITED })
  const before = s.calls().length
  await worker.request('discard.run', { path: EDITED })
  await main.periodic()
  await main.settled()
  // One fetching status in the window: the discard's own second read; the periodic check skipped this workspace.
  const fetching = s.calls().slice(before).filter((c) => c.argv[0] === 'status' && !c.argv.includes('--offline'))
  assert.equal(fetching.length, 1)
  assert.equal(discards(s).length, 1)
})

test('a diff that could not be read is no confirmation: Discard is refused', async () => {
  const { worker } = await setup({ 'mcp call 0': { content: [{ type: 'text', text: 'error: the diff tool failed' }], isError: true } })
  await assert.rejects(worker.request('discard.open', { path: EDITED }), /the diff could not be read/)
  assert.equal(await state(worker), null)
})

test('with "Fetch a remote Forge" off, Discard stays off for a remote Forge', async () => {
  const remote = { kind: 'git', source: 'https://x.example/acme/forge.git', fetched: true }
  const { h, worker } = await setup({ 'status --json --offline': statusDoc({ forge: remote }) })
  h.respond('settings.get', { settings: { craftarPath: (h.data().settings as Record<string, unknown>).craftarPath, craftarHome: '', intervalMinutes: 5, fetch: false } })
  await assert.rejects(worker.request('discard.open', { path: EDITED }), /Fetch a remote Forge/)
})

test("the drift row's Forge side moving between the two clicks draws the confirmation again", async () => {
  const { s, worker, answer } = await setup()
  await worker.request('discard.open', { path: EDITED })
  answer('drift show --json', driftDoc('changed'))
  await worker.request('discard.run', { path: EDITED })
  await main.settled()
  const d = await state(worker)
  assert.equal(d?.phase, 'confirm')
  assert.match(d?.message ?? '', /Forge moved/)
  assert.equal(discards(s).length, 0)
})

test('an orphan-drift row: the file is deleted, and it reads gone', async () => {
  const orphan = JSON.parse(fixture('drift-show.json'))
  orphan.files[0].state = 'orphan-drift'
  const before = JSON.parse(statusDoc().stdout)
  for (const r of before.statuses) if (r.path === EDITED) r.state = 'orphan-drift'
  const after = JSON.parse(statusDoc().stdout)
  after.statuses = after.statuses.filter((r: { path: string }) => r.path !== EDITED)
  const { s, worker, answer } = await setup({ 'drift show --json': { stdout: JSON.stringify(orphan), code: 1 }, 'status --json --offline': { stdout: JSON.stringify(before), code: 0 }, 'status --json': { stdout: JSON.stringify(before), code: 0 } })
  await worker.request('discard.open', { path: EDITED })
  assert.equal((await state(worker))?.deleted, true)
  answer('drift discard', { stdout: 'removed .claude/rules/commit-conventions.md\n', code: 0 })
  // The read after the run sees the file gone.
  const t = JSON.parse(readFileSync(s.env.CRAFTAR_STUB_TABLE, 'utf8'))
  await worker.request('discard.run', { path: EDITED })
  t['status --json --offline'] = { stdout: JSON.stringify(after), code: 0 }
  writeFileSync(s.env.CRAFTAR_STUB_TABLE, JSON.stringify(t))
  await main.settled()
  const d = await state(worker)
  assert.equal(d?.phase, 'done')
  assert.equal(d?.after?.file, 'gone')
})
