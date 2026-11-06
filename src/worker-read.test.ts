// The S1 worker: the self-check on enable, the reads of the focused craftar workspace, the periodic
// read, the panel's requests and the status bar (spec 60 §4–§7.1, O9, O10). Every craftar is a stub.
import { afterEach, assert, mockHost, mountWorker, test } from 'orca/testing'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { removeTempDirs, tempDir } from '../test-support/tmp'
import { fixture, stubCraftar } from '../test-support/stub-craftar'
import * as main from './worker'

const CAPS = ['workspace:read', 'workspace:write', 'terminal:send', 'terminal:read', 'notifications:show', 'storage:own', 'settings:own']
const workers: { deactivate: () => Promise<void> | void }[] = []

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

async function setup(opts: { rows?: Ws[]; ctx?: { branch: string; displayName: string } | null; settings?: Record<string, unknown>; extra?: Record<string, unknown> } = {}) {
  const s = stubCraftar(table(opts.extra))
  const web = craftarDir()
  const rows = opts.rows ?? [{ id: 'w1', kind: 'folder', name: 'web', path: web, branch: 'main', hostId: null }]
  const h = mockHost({
    capabilities: CAPS,
    settings: { craftarPath: s.bin, craftarHome: '', intervalMinutes: 15, fetch: true, ...(opts.settings ?? {}) } as Record<string, string | number | boolean>,
    results: {
      'workspace.list': { workspaces: rows, truncated: false },
      'workspace.readContext': opts.ctx === undefined ? { branch: 'main', displayName: 'web', terminals: [] } : opts.ctx === null ? null : { ...opts.ctx, terminals: [] },
    },
  })
  // The worker's children inherit its environment: the stub's preload rides on NODE_OPTIONS.
  const saved = { NODE_OPTIONS: process.env.NODE_OPTIONS, CRAFTAR_STUB_LOG: process.env.CRAFTAR_STUB_LOG, CRAFTAR_STUB_TABLE: process.env.CRAFTAR_STUB_TABLE }
  Object.assign(process.env, { NODE_OPTIONS: s.env.NODE_OPTIONS, CRAFTAR_STUB_LOG: s.env.CRAFTAR_STUB_LOG, CRAFTAR_STUB_TABLE: s.env.CRAFTAR_STUB_TABLE })
  const worker = await mountWorker(main, { host: h, commands: ['craftar.probe'], events: ['workspace.changed'] })
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

test('S1 writes nothing: no terminal, no typing into one, no notification, no sync child', async () => {
  const { s, h, worker } = await setup()
  await worker.request('state.refresh')
  await main.periodic()
  assert.equal(h.callsOf('terminal.create').length, 0)
  assert.equal(h.callsOf('terminal.sendText').length, 0)
  assert.equal(h.callsOf('notifications.show').length, 0)
  assert.equal(s.calls().some((c) => c.argv.includes('--allow-writes') || c.argv[0] === 'sync'), false)
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
