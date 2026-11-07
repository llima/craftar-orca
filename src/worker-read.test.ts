// The S1 worker: the self-check on enable, the reads of the focused craftar workspace, the periodic
// read, the panel's requests and the status bar (spec 60 §4–§7.1, O9, O10). Every craftar is a stub.
import { afterEach, assert, beforeEach, mockHost, mountWorker, test } from 'orca/testing'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { removeTempDirs, tempDir } from '../test-support/tmp'
import { fixture, stubCraftar } from '../test-support/stub-craftar'
import { psDoc, stubOrcaCli } from '../test-support/stub-orca-cli'
import * as main from './worker'

const CAPS = ['workspace:read', 'workspace:write', 'terminal:send', 'terminal:read', 'notifications:show', 'storage:own', 'settings:own']
const workers: { deactivate: () => Promise<void> | void }[] = []

// No test reaches the person's own Orca: PATH is an empty directory, so no `orca-ide` is found and the focus
// falls back to name and branch, unless a test puts a stub orca-ide (test-support/stub-orca-cli.ts) there.
let savedPath: string | undefined
beforeEach(() => {
  savedPath = process.env.PATH
  process.env.PATH = tempDir('craftar-orca-path-')
})
afterEach(() => {
  process.env.PATH = savedPath
})

afterEach(async () => {
  for (const w of workers.splice(0)) await w.deactivate()
  removeTempDirs()
})

const [INIT, DIFF] = fixture('mcp-diff.jsonl')
  .split('\n')
  .filter((l) => l !== '')
  .map((l) => JSON.parse(l).result)

function craftarDir(): string {
  const dir = tempDir('craftar-orca-ws-')
  writeFileSync(join(dir, 'craftar.yaml'), 'forge: ../forge\nprofile: acme-web\n')
  return dir
}

function table(extra: Record<string, unknown> = {}) {
  return {
    'doctor --json': { stdout: fixture('doctor.json'), code: 0 },
    'workspaces --json': { stdout: fixture('workspaces.json'), code: 0 },
    'status --json': { stdout: fixture('status.json'), code: 0 },
    'drift show --json': { stdout: fixture('drift-show.json'), code: 1 },
    'repos --json': { stdout: fixture('repos.json'), code: 0 },
    'mcp initialize': INIT,
    'mcp call 0': DIFF,
    ...extra,
  }
}

type Ws = { id: string; kind: string; name: string; path: string; branch: string | null; hostId: string | null }

async function setup(opts: { rows?: Ws[]; ctx?: { branch: string; displayName: string; terminals?: { id: string }[] } | null; settings?: Record<string, unknown>; extra?: Record<string, unknown>; results?: Record<string, unknown> } = {}) {
  const s = stubCraftar(table(opts.extra))
  const web = craftarDir()
  const rows = opts.rows ?? [{ id: 'w1', kind: 'folder', name: 'web', path: web, branch: 'main', hostId: null }]
  const h = mockHost({
    capabilities: CAPS,
    settings: { craftarPath: s.bin, craftarHome: '', intervalMinutes: 15, fetch: true, ...(opts.settings ?? {}) } as Record<string, string | number | boolean>,
    results: {
      'workspace.list': { workspaces: rows, truncated: false },
      'workspace.readContext': opts.ctx === undefined ? { branch: 'main', displayName: 'web', terminals: [] } : opts.ctx === null ? null : { terminals: [], ...opts.ctx },
      ...(opts.results ?? {}),
    },
  })
  // The worker's children inherit its environment: the stub's preload rides on NODE_OPTIONS.
  const saved = { NODE_OPTIONS: process.env.NODE_OPTIONS, CRAFTAR_STUB_LOG: process.env.CRAFTAR_STUB_LOG, CRAFTAR_STUB_TABLE: process.env.CRAFTAR_STUB_TABLE }
  Object.assign(process.env, { NODE_OPTIONS: s.env.NODE_OPTIONS, CRAFTAR_STUB_LOG: s.env.CRAFTAR_STUB_LOG, CRAFTAR_STUB_TABLE: s.env.CRAFTAR_STUB_TABLE })
  const worker = await mountWorker(main, { host: h, commands: ['craftar.probe', 'craftar.open'], events: ['workspace.changed'] })
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
  return { s, h, worker, web, rows }
}

type View = {
  focus: string
  selfCheck: { level: string; message: string }[]
  model: { ws: string; forge: { commit: string } | null; pending: { path: string }[] } | null
  ask: { id: string; name: string; path: string }[]
  remote: { name: string; path: string }[]
}

test('on enable: the self-check runs, the focused workspace is read offline, the bar and the panel follow', async () => {
  const { s, h, worker, web } = await setup()
  const argv = s.calls().map((c) => c.argv)
  assert.deepEqual(argv.slice(0, 2), [['doctor', '--json', '--workspace', web], ['workspaces', '--json']])
  assert.deepEqual(argv.find((a) => a[0] === 'status'), ['status', '--json', '--offline', '--workspace', web])
  assert.ok(argv.some((a) => a.join(' ') === `drift show --json --offline --workspace ${web}`))
  const bar = h.callsOf('statusBar.update').at(-1) as { text: string; tone: string }
  assert.equal(bar.text, 'Forge moved · 1 · edited · 1')
  assert.equal(bar.tone, 'warning')
  const view = (await worker.request('state.get')) as View
  assert.equal(view.focus, 'one')
  assert.equal(view.model?.ws, web)
  assert.equal(view.model?.forge?.commit, 'd2309dc201c9a5127285a83092fb3853b8926101')
  assert.ok(worker.posts.some((p) => p.event === 'state.changed'))
  assert.deepEqual(worker.refusals, [])
})

test('a read writes nothing: no terminal, no typing into one, no sync child', async () => {
  const { s, h, worker } = await setup()
  await worker.request('state.refresh')
  await main.periodic()
  assert.equal(h.callsOf('terminal.create').length, 0)
  assert.equal(h.callsOf('terminal.sendText').length, 0)
  assert.equal(s.calls().some((c) => c.argv.includes('--allow-writes') || c.argv[0] === 'sync'), false)
})

// O3/O4: the timer only reads and notifies — one notification when the pending set grows, names and counts.
test('a periodic read whose pending set grew notifies once, with the Forge, the count and the workspace only', async () => {
  const { h, worker } = await setup()
  await worker.request('state.refresh')
  assert.equal(h.callsOf('notifications.show').length, 0, 'a focus read does not notify')
  await main.periodic()
  const shown = h.callsOf('notifications.show') as { title: string; body?: string }[]
  assert.equal(shown.length, 1)
  assert.equal(shown[0].title, 'craftar')
  assert.equal(shown[0].body, 'Forge ../forge2 changed 1 file for web — update 1 file and add it to the commit? Open the craftar panel.')
  await main.periodic()
  assert.equal(h.callsOf('notifications.show').length, 1, 'the same count again does not notify')
  const stored = h.data().storage['notified'] as Record<string, Record<string, unknown>>
  for (const v of Object.values(stored)) assert.deepEqual(Object.keys(v).sort(), ['at', 'count'])
})

test('the periodic read fetches every local craftar workspace; with fetch off it stays offline', async () => {
  const other = craftarDir()
  const rows = (web: string): Ws[] => [
    { id: 'w1', kind: 'folder', name: 'web', path: web, branch: 'main', hostId: null },
    { id: 'w2', kind: 'folder', name: 'ws', path: other, branch: 'main', hostId: null },
  ]
  const a = await setup()
  a.h.respond('workspace.list', { workspaces: rows(a.web), truncated: false })
  const before = a.s.calls().length
  await main.periodic()
  const periodic = a.s.calls().slice(before).filter((c) => c.argv[0] === 'status')
  assert.deepEqual(periodic.map((c) => c.argv), [
    ['status', '--json', '--workspace', a.web],
    ['status', '--json', '--workspace', other],
  ])
  await workers.splice(0)[0].deactivate()
  const b = await setup({ settings: { fetch: false } })
  await main.periodic()
  assert.equal(b.s.calls().filter((c) => c.argv[0] === 'status').every((c) => c.argv.includes('--offline')), true)
})

test('a workspace on another host is listed and never handed to craftar', async () => {
  const rows: Ws[] = [{ id: 'r1', kind: 'folder', name: 'web', path: '/home/acme/elsewhere', branch: 'main', hostId: 'ssh-1' }]
  const { s, worker } = await setup({ rows })
  const view = (await worker.request('state.get')) as View
  assert.deepEqual(view.remote, [{ name: 'web', path: '/home/acme/elsewhere' }])
  assert.equal(s.calls().some((c) => c.argv.includes('/home/acme/elsewhere')), false)
  assert.equal(view.focus, 'none')
})

test('a tie asks the person; the answer is stored as a workspace id only and the chosen one is read', async () => {
  const one = craftarDir()
  const two = craftarDir()
  const rows: Ws[] = [
    { id: 'a', kind: 'worktree', name: 'web', path: one, branch: 'main', hostId: null },
    { id: 'b', kind: 'worktree', name: 'web', path: two, branch: 'main', hostId: null },
  ]
  const { s, h, worker } = await setup({ rows })
  const asked = (await worker.request('state.get')) as View
  assert.equal(asked.focus, 'ask')
  assert.deepEqual(asked.ask.map((r) => r.id), ['a', 'b'])
  assert.equal(s.calls().some((c) => c.argv[0] === 'status'), false)
  await worker.request('focus.choose', { id: 'b' })
  assert.equal(h.data().storage['focus.choice'], 'b')
  const chosen = (await worker.request('state.get')) as View
  assert.equal(chosen.model?.ws, two)
  await assert.rejects(worker.request('focus.choose', { id: '../../etc' }), /not one of the workspaces/)
})

test('a focus change reads the newly focused workspace offline', async () => {
  const api = craftarDir()
  const { s, h, worker, web } = await setup()
  h.respond('workspace.list', {
    workspaces: [
      { id: 'w1', kind: 'folder', name: 'web', path: web, branch: 'main', hostId: null },
      { id: 'w2', kind: 'folder', name: 'api', path: api, branch: 'dev', hostId: null },
    ],
    truncated: false,
  })
  await worker.emit('workspace.changed', { context: { branch: 'dev', displayName: 'api', terminals: [] } })
  await main.settled()
  const last = s.calls().filter((c) => c.argv[0] === 'status').at(-1)
  assert.deepEqual(last?.argv, ['status', '--json', '--offline', '--workspace', api])
})

test('a diff is asked only for a path the last read listed; the mcp child never gets --fetch or --allow-writes', async () => {
  const { s, worker } = await setup()
  const r = (await worker.request('diff.get', { path: '.claude/rules/workflow.md' })) as { files: { diff: string }[] }
  assert.match(r.files[0].diff, /Forge change/)
  const unknown = (await worker.request('diff.get', { path: '../../etc/passwd' })) as { refused: string }
  assert.match(unknown.refused, /not a file this workspace lists/)
  const mcp = s.calls().filter((c) => c.argv[0] === 'mcp')
  assert.equal(mcp.length, 1)
  assert.equal(mcp[0].argv.some((a) => a === '--fetch' || a === '--allow-writes'), false)
  assert.equal(worker.logs.some((l) => /Forge change/.test(l)), false)
})

test('a self-check that fails reads nothing, shows its lines and turns the bar to error', async () => {
  const { s, h, worker } = await setup({ extra: { 'doctor --json': { stdout: JSON.stringify({ ...JSON.parse(fixture('doctor.json')), version: '0.30.0' }), code: 0 } } })
  const view = (await worker.request('state.get')) as View
  assert.match(view.selfCheck.map((l) => l.message).join('\n'), /0\.30\.0 is older than 0\.33\.0/)
  assert.equal(s.calls().some((c) => c.argv[0] === 'status'), false)
  assert.equal((h.callsOf('statusBar.update').at(-1) as { text: string }).text, 'craftar: error')
})

test('a status read that fails turns the bar to error and keeps nothing of craftar output in the logs', async () => {
  const { h, worker } = await setup({ extra: { 'status --json': { stdout: 'acme-private-output', code: 1, stderr: '/home/acme/private' } } })
  assert.equal((h.callsOf('statusBar.update').at(-1) as { text: string }).text, 'craftar: error')
  assert.equal(worker.logs.some((l) => /acme-private|home\/acme\/private/.test(l)), false)
})

test('storage holds paths, timestamps and an id only — no document from craftar', async () => {
  const { h } = await setup()
  const stored = JSON.stringify(h.data().storage)
  assert.doesNotMatch(stored, /commit-conventions|d2309dc2|warnings/)
})

test("the self-check's doctor never overlaps a read of the same workspace", async () => {
  const { s, worker, web } = await setup({ extra: { 'status --json': { stdout: fixture('status.json'), code: 0, delayMs: 400 } } })
  const p = main.periodic()
  await new Promise((r) => setTimeout(r, 100))
  await worker.request('state.refresh')
  await p
  await main.settled()
  const onWeb = s.spans().filter((x) => x.argv.includes(web)).sort((a, b) => a.start - b.start)
  for (let i = 1; i < onWeb.length; i++) assert.ok(onWeb[i].start >= onWeb[i - 1].end, `${onWeb[i].argv[0]} overlapped ${onWeb[i - 1].argv[0]}`)
})

test('a changed craftarHome reaches the next read and a fresh diff child, with no focus change', async () => {
  const { s, h, worker } = await setup()
  await worker.request('diff.get', { path: '.claude/rules/workflow.md' })
  h.respond('settings.get', { settings: { craftarPath: s.bin, craftarHome: '/home/acme/other-home', intervalMinutes: 15, fetch: true } })
  await main.periodic()
  assert.equal(s.calls().filter((c) => c.argv[0] === 'status').at(-1)?.home, '/home/acme/other-home')
  await worker.request('diff.get', { path: '.claude/rules/workflow.md' })
  const mcp = s.calls().filter((c) => c.argv[0] === 'mcp')
  assert.deepEqual(mcp.map((c) => c.home), [null, '/home/acme/other-home'])
})

test('with no focused craftar workspace the self-check asks doctor about a local one, never about Orca\'s directory', async () => {
  const { s, web } = await setup({ ctx: null })
  const doctors = s.calls().filter((c) => c.argv[0] === 'doctor')
  assert.ok(doctors.length >= 1)
  assert.ok(doctors.every((c) => c.argv.join(' ') === `doctor --json --workspace ${web}`))
})

test('with no craftar workspace in Orca nothing is started and the self-check says why', async () => {
  const { s, worker } = await setup({ rows: [] })
  assert.equal(s.calls().length, 0)
  const view = (await worker.request('state.get')) as View
  assert.match(view.selfCheck.map((l) => l.message).join('\n'), /no craftar workspace/)
})

test('a craftar workspace that appears after a check with none is read by the next periodic check', async () => {
  const { s, h } = await setup({ rows: [] })
  const later = craftarDir()
  h.respond('workspace.list', { workspaces: [{ id: 'w9', kind: 'folder', name: 'web', path: later, branch: 'main', hostId: null }], truncated: false })
  await main.periodic()
  assert.ok(s.calls().some((c) => c.argv.join(' ') === `status --json --workspace ${later}`))
})

// Measured in Orca 1.4.250 (2026-11-07): workspace.readContext names a workspace by its display name and
// branch only, and every `main` worktree there is named `main` — so name and branch tie, the panel asks,
// and the probe must open its terminal in the workspace the person chose, not deduce one of its own.
test('after a tie is answered, the probe opens its terminal in the chosen workspace', async () => {
  const one = craftarDir()
  const two = craftarDir()
  const rows: Ws[] = [
    { id: 'a', kind: 'worktree', name: 'main', path: one, branch: 'main', hostId: 'local' },
    { id: 'b', kind: 'worktree', name: 'main', path: two, branch: 'main', hostId: 'local' },
  ]
  const { h, worker } = await setup({
    rows,
    ctx: { branch: 'main', displayName: 'main' },
    results: { 'terminal.create': { terminalId: 't1' }, 'terminal.read': { lines: ['craftar-probe'], truncated: false } },
  })
  assert.equal(((await worker.request('state.get')) as View).focus, 'ask')
  await worker.request('focus.choose', { id: 'b' })
  const report = String(await worker.command('craftar.probe'))
  assert.match(report, /terminal: craftar-probe seen/)
  assert.deepEqual(h.callsOf('terminal.create').map((c) => (c as { workspaceId: string }).workspaceId), ['b'])
})

test('with a tie not yet answered, the probe opens no terminal and says to pick one in the panel', async () => {
  const rows: Ws[] = [
    { id: 'a', kind: 'worktree', name: 'main', path: craftarDir(), branch: 'main', hostId: 'local' },
    { id: 'b', kind: 'worktree', name: 'main', path: craftarDir(), branch: 'main', hostId: 'local' },
  ]
  const { h, worker } = await setup({ rows, ctx: { branch: 'main', displayName: 'main' } })
  const report = String(await worker.command('craftar.probe'))
  assert.match(report, /terminal: not opened — several workspaces match the focused one: pick it in the craftar panel/)
  assert.equal(h.callsOf('terminal.create').length, 0)
})

// Orca's CLI as the source of the focus (the user's ruling, 2026-11-07).
test('with Orca naming the active workspace, a name-and-branch tie is no question: that workspace is read', { skip: process.platform === 'win32' }, async () => {
  const one = craftarDir()
  const two = craftarDir()
  process.env.PATH = stubOrcaCli({ ps: psDoc([{ path: one }, { path: two, active: true }]) }).dir
  const rows: Ws[] = [
    { id: 'a', kind: 'worktree', name: 'main', path: one, branch: 'main', hostId: 'local' },
    { id: 'b', kind: 'worktree', name: 'main', path: two, branch: 'main', hostId: 'local' },
  ]
  const { s, worker } = await setup({ rows, ctx: { branch: 'main', displayName: 'main' } })
  const view = (await worker.request('state.get')) as View
  assert.equal(view.focus, 'one')
  assert.equal(view.model?.ws, two)
  assert.ok(s.calls().some((c) => c.argv[0] === 'status' && c.argv.includes(two)))
  assert.equal(s.calls().some((c) => c.argv[0] === 'status' && c.argv.includes(one)), false)
})

test("Orca's active workspace that holds no craftar.yaml is no focus, and nothing is read", { skip: process.platform === 'win32' }, async () => {
  const one = craftarDir()
  const plain = tempDir('craftar-orca-plain-')
  process.env.PATH = stubOrcaCli({ ps: psDoc([{ path: one }, { path: plain, active: true }]) }).dir
  const rows: Ws[] = [
    { id: 'a', kind: 'worktree', name: 'main', path: one, branch: 'main', hostId: 'local' },
    { id: 'p', kind: 'worktree', name: 'main', path: plain, branch: 'main', hostId: 'local' },
  ]
  const { s, worker } = await setup({ rows, ctx: { branch: 'main', displayName: 'main' } })
  assert.equal(((await worker.request('state.get')) as View).focus, 'none')
  assert.equal(s.calls().some((c) => c.argv[0] === 'status'), false)
})

test('the probe says whether Orca named an active workspace, never which', { skip: process.platform === 'win32' }, async () => {
  const one = craftarDir()
  process.env.PATH = stubOrcaCli({ ps: psDoc([{ path: one, active: true }]) }).dir
  const rows: Ws[] = [{ id: 'a', kind: 'worktree', name: 'main', path: one, branch: 'main', hostId: 'local' }]
  const { worker } = await setup({
    rows,
    ctx: { branch: 'main', displayName: 'main' },
    results: { 'terminal.create': { terminalId: 't1' }, 'terminal.read': { lines: ['craftar-probe'], truncated: false } },
  })
  const report = String(await worker.command('craftar.probe'))
  assert.match(report, /Orca CLI \(orca-ide\): on an absolute PATH entry — active workspace: found/)
  assert.equal(worker.logs.join('\n').includes(one), false)
})

test('an Orca CLI that does not answer within 5 s is no answer: no terminal list after it, and name and branch decide', { skip: process.platform === 'win32' }, async () => {
  // The active row names a workspace with no craftar.yaml: had the CLI answered (a limit above 7 s), the
  // focus would be none. Within 5 s it does not, so the name-and-branch tier focuses the craftar one.
  const one = craftarDir()
  const plain = tempDir('craftar-orca-plain-')
  const s = stubOrcaCli({ ps: psDoc([{ path: one }, { path: plain, active: true }]), psDelaySeconds: 7 })
  process.env.PATH = s.dir
  const rows: Ws[] = [
    { id: 'a', kind: 'worktree', name: 'main', path: one, branch: 'main', hostId: 'local' },
    { id: 'p', kind: 'worktree', name: 'other', path: plain, branch: 'main', hostId: 'local' },
  ]
  const { worker } = await setup({ rows, ctx: { branch: 'main', displayName: 'main', terminals: [{ id: 'term_1' }] } })
  const view = (await worker.request('state.get')) as View
  assert.equal(view.focus, 'one')
  assert.equal(view.model?.ws, one)
  // Activation refreshes twice (Orca delivers the current context to a new subscriber); one call each.
  assert.ok(s.calls().length > 0)
  assert.ok(s.calls().every((c) => c === 'worktree ps --json'))
})
