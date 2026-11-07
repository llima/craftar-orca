// The S1 worker: the self-check on enable, the reads of the focused craftar workspace, the periodic
// read, the panel's requests and the status bar (spec 60 §4–§7.1, O9, O10). Every craftar is a stub.
import { afterEach, assert, beforeEach, mockHost, mountWorker, test } from 'orca/testing'
import { execFileSync } from 'node:child_process'
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { findOnPath } from './resolve'
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
  update: { allowed: boolean; reason: string | null; files: { path: string; state: string }[] }
  sync: { phase: string; message: string | null }
  consent: { text: string; terminal: string; steps: string[] } | null
  lastSync: { written: string[]; removed: { path: string; reason: string }[]; kept: { path: string; state: string; reason: string }[]; staged: string[]; leftOut: string[]; differences: string[]; warnings: string[]; rerun: boolean } | null
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


// S2, the incoming path (spec 60 §7, O2): Update in the panel syncs through craftar mcp --allow-writes and stages exactly.
const ORIGINAL_PATH = savedOriginalPath()
function savedOriginalPath(): string {
  return process.env.PATH ?? ''
}
// A directory holding only a link to git: git's own directory (often /usr/bin) can hold orca-ide too, and no
// test may reach the person's own Orca.
function gitDirOnPath(): string {
  const git = findOnPath('git', ORIGINAL_PATH)
  if (!git) return ''
  const dir = tempDir('craftar-orca-gitbin-')
  symlinkSync(git, join(dir, 'git'))
  return dir
}
function gitCraftarDir(): string {
  const dir = craftarDir()
  const env = { ...process.env, PATH: ORIGINAL_PATH, GIT_AUTHOR_NAME: 'acme', GIT_AUTHOR_EMAIL: 'acme@example.com', GIT_COMMITTER_NAME: 'acme', GIT_COMMITTER_EMAIL: 'acme@example.com' }
  const g = (...a: string[]) => execFileSync('git', ['-C', dir, ...a], { env })
  g('init', '-q', '-b', 'main')
  mkdirSync(join(dir, '.claude', 'rules'), { recursive: true })
  writeFileSync(join(dir, '.claude', 'rules', 'workflow.md'), 'old\n')
  writeFileSync(join(dir, 'craftar.lock'), '{}\n')
  g('add', '-A')
  g('commit', '-q', '-m', 'init')
  return dir
}
const SYNCED = {
  profile: 'acme-web', recipes: ['base'], targets: ['claude-code'], forge: 'forge ../forge2 @ d2309dc',
  written: ['.claude/rules/workflow.md'], removed: [],
  skipped: [{ path: '.claude/rules/commit-conventions.md', state: 'drift', reason: 'edited by hand — kept' }],
  warnings: ['agents-md: the rule is long'], registry: 'updated',
}
const synced = { content: [{ type: 'text', text: JSON.stringify(SYNCED) }], structuredContent: SYNCED }
const toolError = (text: string) => ({ content: [{ type: 'text', text }], isError: true })

async function updateAndWait(worker: { request: (name: string, data?: unknown) => Promise<unknown> }): Promise<View> {
  await worker.request('update.run', { files: ['.claude/rules/workflow.md'] })
  await main.settled()
  return (await worker.request('state.get')) as View
}

async function updateSetup(extra: Record<string, unknown>, settings: Record<string, unknown> = {}) {
  const ws = gitCraftarDir()
  const r = await setup({ rows: [{ id: 'w1', kind: 'folder', name: 'web', path: ws, branch: 'main', hostId: 'local' }], extra, settings })
  process.env.PATH = gitDirOnPath()
  return { ...r, ws }
}

test('Update is offered with the pending files, then syncs, stages exactly and shows what it did', { skip: !findOnPath('git', process.env.PATH ?? '') && !process.env.CI }, async () => {
  const { s, h, worker, ws } = await updateSetup({ 'mcp call 0': synced })
  const before = (await worker.request('state.get')) as View
  assert.equal(before.update.allowed, true)
  assert.deepEqual(before.update.files, [{ path: '.claude/rules/workflow.md', state: 'update' }])
  writeFileSync(join(ws, '.claude', 'rules', 'workflow.md'), 'new\n')
  const after = (await updateAndWait(worker))
  const mcp = s.calls().filter((c) => c.argv[0] === 'mcp')
  assert.deepEqual(mcp.map((c) => c.argv), [['mcp', '--workspace', ws, '--allow-writes', '--fetch']])
  assert.equal(after.sync.phase, 'done')
  assert.deepEqual(after.lastSync?.staged, ['.claude/rules/workflow.md'])
  assert.deepEqual(after.lastSync?.kept, SYNCED.skipped)
  assert.deepEqual(after.lastSync?.warnings, SYNCED.warnings)
  assert.deepEqual(after.lastSync?.differences, [])
  assert.deepEqual(h.callsOf('commands.run'), [{ action: 'sidebar.sourceControl.toggle' }])
  const staged = execFileSync('git', ['-C', ws, 'diff', '--cached', '--name-only'], { encoding: 'utf8', env: { ...process.env, PATH: ORIGINAL_PATH } }).trim()
  assert.equal(staged, '.claude/rules/workflow.md')
  const commits = execFileSync('git', ['-C', ws, 'rev-list', '--count', 'HEAD'], { encoding: 'utf8', env: { ...process.env, PATH: ORIGINAL_PATH } }).trim()
  assert.equal(commits, '1')
  assert.equal(h.callsOf('terminal.sendText').length, 0)
})

test('Update refuses a list that is not the pending set: nothing is started', async () => {
  const { s, worker } = await updateSetup({ 'mcp call 0': synced })
  await assert.rejects(worker.request('update.run', { files: ['.claude/rules/other.md'] }), /the files changed since the panel showed them/)
  assert.equal(s.calls().some((c) => c.argv.includes('--allow-writes')), false)
})

test("with no consent recorded, Update writes nothing and shows craftar's words and the way to allow writes", async () => {
  const text = 'writing is not allowed in this workspace — a person types craftar mcp allow-writes in it, in a terminal, to allow it'
  const { h, worker } = await updateSetup({ 'mcp call 0': toolError(text) })
  const after = (await updateAndWait(worker))
  assert.equal(after.sync.phase, 'consent')
  assert.equal(after.consent?.text, text)
  assert.equal(after.lastSync, null)
  assert.equal(h.callsOf('commands.run').length, 0)
})

test('a refused sync in other words is an error shown verbatim, and nothing is staged', async () => {
  const text = 'declared params with no value: acme.key — the sync is refused'
  const { h, worker } = await updateSetup({ 'mcp call 0': toolError(text) })
  const after = (await updateAndWait(worker))
  assert.deepEqual(after.sync, { phase: 'error', message: text })
  assert.equal(h.callsOf('commands.run').length, 0)
})

const remoteStatus = (fetched: boolean) => {
  const status = JSON.parse(fixture('status.json'))
  return { stdout: JSON.stringify({ ...status, forge: { ...status.forge, kind: 'git', fetched } }), code: 0 }
}

test('a remote Forge never fetched yet: Update is off and says the next periodic check fetches it', async () => {
  const { worker } = await updateSetup({ 'status --json': remoteStatus(false) })
  const v = (await worker.request('state.get')) as View
  assert.equal(v.update.allowed, false)
  assert.match(String(v.update.reason), /not been fetched yet/)
})

test('a periodic fetch that worked allows Update after offline focus reads', async () => {
  // A focus read is --offline (fetched: false); the periodic read fetches (fetched: true).
  const { worker } = await updateSetup({ 'status --json --offline': remoteStatus(false), 'status --json --workspace': remoteStatus(true) })
  await main.periodic()
  await worker.request('state.refresh')
  const v = (await worker.request('state.get')) as View
  assert.equal(v.update.allowed, true, String(v.update.reason))
})

test('a periodic fetch that fell back to the cached copy keeps Update off, with the cache named', async () => {
  const { worker } = await updateSetup({ 'status --json': remoteStatus(false) })
  await main.periodic()
  const v = (await worker.request('state.get')) as View
  assert.equal(v.update.allowed, false)
  assert.match(String(v.update.reason), /cached copy/)
})

// O2/O12: the consent stays craftar's — the plugin opens a terminal running craftar mcp allow-writes, quoted
// for the shell the probe recognised, and the person answers its question; it never types into a terminal.
test('the consent terminal: a shell probe first, then allow-writes quoted for that shell; nothing typed', async () => {
  const text = 'writing is not allowed in this workspace — a person types craftar mcp allow-writes in it, in a terminal, to allow it'
  const { s, h, worker, ws } = await updateSetup({ 'mcp call 0': toolError(text) })
  const asked = (await updateAndWait(worker))
  assert.equal(asked.consent?.terminal, 'offered')
  h.respond('terminal.create', { terminalId: 't1' })
  h.respond('terminal.read', { lines: ['acme-user@acme-host:~$ echo craftar-shell:$0', 'craftar-shell:bash'], truncated: false })
  await worker.request('consent.terminal', {})
  const created = h.callsOf('terminal.create') as { workspaceId: string; title?: string; command?: string }[]
  assert.equal(created.length, 2)
  assert.equal(created[0].command, 'echo craftar-shell:$0')
  assert.equal(created[1].command, `'${s.bin}' mcp allow-writes --workspace '${ws}'`)
  assert.equal(h.callsOf('terminal.sendText').length, 0)
  assert.equal(h.data().storage['shell.local'], 'bash')
})

test('a shell the probe does not recognise gets no terminal: the steps stay in words', async () => {
  const text = 'writing is not allowed in this workspace — a person types craftar mcp allow-writes in it, in a terminal, to allow it'
  const { h, worker } = await updateSetup({ 'mcp call 0': toolError(text) })
  await updateAndWait(worker)
  h.respond('terminal.create', { terminalId: 't1' })
  h.respond('terminal.read', { lines: ['fish: $0 is not supported'], truncated: false })
  const v = (await worker.request('consent.terminal', {})) as View
  assert.equal((h.callsOf('terminal.create') as unknown[]).length, 1)
  assert.equal(v.consent?.terminal, 'words')
  const steps = v.consent?.steps ?? []
  assert.match(steps[0], /No terminal was opened: the plugin does not recognise this terminal's shell/)
  assert.ok(steps.some((x) => x.includes('allow-writes')))
  // In words, never a command line to paste: no step starts with the binary or holds a ready command.
  assert.equal(steps.some((x) => /craftar mcp allow-writes --workspace/.test(x)), false)
  assert.equal(h.callsOf('terminal.sendText').length, 0)
})

test('a read that gave no document leaves Update off and says why (no cached copy to show)', async () => {
  const { worker } = await updateSetup({ 'status --json': { stdout: 'not json', code: 1 } })
  const v = (await worker.request('state.get')) as View
  assert.equal(v.update.allowed, false)
  assert.match(String(v.update.reason), /gave no document/)
})

test("a consent belongs to the workspace that was refused: after a focus change, no terminal opens for another", { skip: process.platform === 'win32' }, async () => {
  const text = 'writing is not allowed in this workspace — a person types craftar mcp allow-writes in it, in a terminal, to allow it'
  const a = gitCraftarDir()
  const b = gitCraftarDir()
  const rows: Ws[] = [
    { id: 'wa', kind: 'folder', name: 'web', path: a, branch: 'main', hostId: 'local' },
    { id: 'wb', kind: 'folder', name: 'api', path: b, branch: 'dev', hostId: 'local' },
  ]
  const { h, worker } = await setup({ rows, extra: { 'mcp call 0': toolError(text) } })
  process.env.PATH = gitDirOnPath()
  const asked = (await updateAndWait(worker))
  assert.equal(asked.consent?.terminal, 'offered')
  await worker.emit('workspace.changed', { context: { branch: 'dev', displayName: 'api', terminals: [] } })
  await main.settled()
  const onB = (await worker.request('state.get')) as View
  assert.equal(onB.focus, 'one', JSON.stringify({ focus: onB.focus, ask: onB.ask.length }))
  assert.equal(onB.model?.ws, b)
  assert.equal(onB.consent, null)
  assert.equal(onB.sync.phase, 'idle')
  await assert.rejects(worker.request('consent.terminal', {}), /nothing to allow/)
  assert.equal(h.callsOf('terminal.create').length, 0)
})

test('a shell probe that shows no answer is not stored: the next click probes again', async () => {
  const text = 'writing is not allowed in this workspace — a person types craftar mcp allow-writes in it, in a terminal, to allow it'
  const { h, worker } = await updateSetup({ 'mcp call 0': toolError(text) })
  await updateAndWait(worker)
  h.respond('terminal.create', { terminalId: 't1' })
  h.respond('terminal.read', { lines: ['acme-user@acme-host:~$ '], truncated: false })
  await worker.request('consent.terminal', {})
  assert.equal(h.data().storage['shell.local'], undefined)
})

test('a notification is not sent for a workspace Update could not run on: a refused sync', async () => {
  const status = JSON.parse(fixture('status.json'))
  status.unsetParams = [{ key: 'acme.key', declaredBy: ['rule/a'], citedBy: ['rule/a'] }]
  const { h } = await updateSetup({ 'status --json': { stdout: JSON.stringify(status), code: 1 } })
  await main.periodic()
  assert.equal(h.callsOf('notifications.show').length, 0)
})

test('update.run answers at once with the update running; the panel follows on state.changed', async () => {
  const { worker } = await updateSetup({ 'mcp call 0': synced })
  const started = (await worker.request('update.run', { files: ['.claude/rules/workflow.md'] })) as View
  assert.equal(started.sync.phase, 'running')
  await main.settled()
  const done = (await worker.request('state.get')) as View
  assert.equal(done.sync.phase, 'done')
})

test('with "Fetch a remote Forge" off, Update for a remote Forge stays off and says so', async () => {
  const { worker } = await updateSetup({ 'status --json': remoteStatus(false) }, { fetch: false })
  await main.periodic()
  const v = (await worker.request('state.get')) as View
  assert.equal(v.update.allowed, false)
  assert.match(String(v.update.reason), /Fetch a remote Forge" is off/)
})

test('no notification after a periodic fetch that fell back to the cached copy', async () => {
  const { h } = await updateSetup({ 'status --json': remoteStatus(false) })
  await main.periodic()
  assert.equal(h.callsOf('notifications.show').length, 0)
})

test('no notification for a craftar older than 0.35.0: Update could not run', async () => {
  const doctor = JSON.parse(fixture('doctor.json'))
  doctor.version = '0.34.0'
  const { h, worker } = await updateSetup({ 'doctor --json': { stdout: JSON.stringify(doctor), code: 0 } })
  await main.periodic()
  assert.equal(h.callsOf('notifications.show').length, 0)
  const v = (await worker.request('state.get')) as View
  assert.match(String(v.update.reason), /0\.35\.0/)
})
