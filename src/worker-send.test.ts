// S3a, Send to Forge (spec 60 §8, O5, O7): the dry run on the first click, the write on a second; the Forge
// directory asked once for a URL Forge; one notification per newly edited file; the save hook only marks.
import { afterEach, assert, beforeEach, mockHost, mountWorker, test } from 'orca/testing'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { removeTempDirs, tempDir } from '../test-support/tmp'
import { fixture, stubCraftar } from '../test-support/stub-craftar'
import * as main from './worker'

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
const PLAN = {
  workspace: '', forge: '/home/acme/forge2', profile: 'acme-web', dryRun: true, path: EDITED, ingredient: 'rule/commit-conventions',
  outcome: 'variant', promoted: 'rule/commit-conventions--acme-web', written: [{ path: 'ingredients/rules/commit-conventions--acme-web/rule.md', action: 'created' }],
  params: [], sections: [], flattened: { params: [], sections: [] }, dependents: [], nextSync: { counts: { unchanged: 4 } }, impact: { registry: 'read', workspaces: [] }, warnings: [],
}

async function setup(opts: { extra?: Record<string, unknown>; remote?: boolean } = {}) {
  const status = JSON.parse(fixture('status.json'))
  if (opts.remote) status.forge = { ...status.forge, kind: 'git', fetched: false }
  const s = stubCraftar({
    'doctor --json': { stdout: fixture('doctor.json'), code: 0 },
    'workspaces --json': { stdout: fixture('workspaces.json'), code: 0 },
    'status --json': { stdout: JSON.stringify(status), code: 0 },
    'drift show --json': { stdout: fixture('drift-show.json'), code: 1 },
    'repos --json': { stdout: fixture('repos.json'), code: 0 },
    ...(opts.extra ?? {}),
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
  return { s, h, worker, web }
}

async function sendAndWait(worker: { request: (n: string, d?: unknown) => Promise<unknown> }, name: string, data: unknown): Promise<View> {
  await worker.request(name, data)
  await main.settled()
  return (await worker.request('state.get')) as View
}

type View = {
  send: { path: string; phase: string; plan: { outcome: string; written: unknown[] } | null; result: { dryRun: boolean } | null; message: string | null } | null
  forgeDir: { needed: boolean; dir: string | null }
  marked: string[]
  sendRefused: { path: string; message: string }[]
}

test('Send runs the dry run first; Write to the Forge runs the write; nothing is written before the second click', async () => {
  const { s, worker, web } = await setup({ extra: { 'drift promote': { stdout: JSON.stringify(PLAN), code: 0 } } })
  const previewed = (await sendAndWait(worker, 'send.preview', { path: EDITED }))
  assert.equal(previewed.send?.phase, 'preview')
  assert.equal(previewed.send?.plan?.outcome, 'variant')
  const promotes = () => s.calls().filter((c) => c.argv[0] === 'drift' && c.argv[1] === 'promote').map((c) => c.argv)
  assert.deepEqual(promotes(), [['drift', 'promote', EDITED, '--workspace', web, '--dry-run', '--json']])
  const done = (await sendAndWait(worker, 'send.run', { path: EDITED }))
  assert.equal(done.send?.phase, 'done')
  assert.deepEqual(promotes()[1], ['drift', 'promote', EDITED, '--workspace', web, '--json'])
})

test('Write to the Forge without a dry run of that file first is refused, and nothing runs', async () => {
  const { s, worker } = await setup({ extra: { 'drift promote': { stdout: JSON.stringify(PLAN), code: 0 } } })
  await assert.rejects(worker.request('send.run', { path: EDITED }), /look at the plan first/)
  assert.equal(s.calls().some((c) => c.argv[1] === 'promote'), false)
})

test("a file the workspace does not list as promotable is refused; craftar's refusal of a dry run returns to the workspace, the file kept in its words", async () => {
  const { worker } = await setup({ extra: { 'drift promote': { stdout: '', code: 1, stderr: 'error: D16: promote refused\n' } } })
  await assert.rejects(worker.request('send.preview', { path: '.claude/rules/other.md' }), /not a file this workspace can send/)
  const v = (await sendAndWait(worker, 'send.preview', { path: EDITED }))
  // No send screen to be stuck on: the panel is back on the workspace, and the refusal is kept per file.
  assert.equal(v.send, null)
  assert.deepEqual(v.sendRefused, [{ path: EDITED, message: 'error: D16: promote refused' }])
  // Saving the file again is a new edit: the refusal is asked again.
  await worker.hooks.fire('editor.save.before', { workspaceId: 'w1', path: EDITED, text: 'x' })
  assert.deepEqual(((await worker.request('state.get')) as View).sendRefused, [])
})

test('a URL Forge needs a local clone named once: before it, Send says so; after it, --forge is passed', async () => {
  const { s, h, worker, web } = await setup({ remote: true, extra: { 'drift promote': { stdout: JSON.stringify(PLAN), code: 0 } } })
  let v = (await worker.request('state.get')) as View
  assert.deepEqual(v.forgeDir, { needed: true, dir: null })
  await assert.rejects(worker.request('send.preview', { path: EDITED }), /local clone of the Forge/)
  const clone = tempDir('craftar-orca-clone-')
  v = (await worker.request('forge.dir.set', { dir: clone })) as View
  assert.deepEqual(v.forgeDir, { needed: true, dir: clone })
  await sendAndWait(worker, 'send.preview', { path: EDITED })
  assert.ok(s.calls().some((c) => c.argv.join(' ') === `drift promote ${EDITED} --workspace ${web} --forge ${clone} --dry-run --json`))
  const stored = h.data().storage['forge.dir'] as Record<string, string>
  assert.deepEqual(stored, { [web]: clone })
  await assert.rejects(worker.request('forge.dir.set', { dir: 'relative/dir' }), /absolute path of a folder/)
})

test('one notification per newly edited file that can be sent, with the path and the Forge only', async () => {
  const { h } = await setup()
  await main.periodic()
  await main.periodic()
  const shown = (h.callsOf('notifications.show') as { body?: string }[]).filter((n) => String(n.body).includes('send the change'))
  assert.equal(shown.length, 1)
  assert.equal(shown[0].body, `${EDITED} belongs to Forge ../forge2: send the change to the Forge? Open the craftar panel.`)
})

test('the save hook passes the save at once, keeps nothing of the text, and only marks a Forge file', async () => {
  const { worker } = await setup()
  const secret = 'acme-sentinel-' + 'q'.repeat(20)
  const r = await worker.hooks.fire('editor.save.before', { workspaceId: 'w1', path: EDITED, text: secret })
  assert.equal(JSON.stringify(r ?? null).includes('deny'), false)
  const v = (await worker.request('state.get')) as View
  assert.deepEqual(v.marked, [EDITED])
  assert.equal(JSON.stringify(v).includes(secret), false)
  assert.equal(worker.logs.some((l) => l.includes(secret)), false)
  await worker.hooks.fire('editor.save.before', { workspaceId: 'w1', path: 'src/not-from-the-forge.ts', text: 'x' })
  assert.deepEqual(((await worker.request('state.get')) as View).marked, [EDITED])
})

test('the save hook also marks a Forge file given as an absolute path under the workspace (Orca: relative inside one)', async () => {
  const { worker, web } = await setup()
  await worker.hooks.fire('editor.save.before', { workspaceId: 'w1', path: join(web, EDITED), text: 'x' })
  assert.deepEqual(((await worker.request('state.get')) as View).marked, [EDITED])
})

test('a save whose workspace id the list does not hold marks the focused workspace; the log says yes/no, never the path', async () => {
  const { worker } = await setup()
  await worker.hooks.fire('editor.save.before', { workspaceId: 'editor-tab-id', path: EDITED, text: 'x' })
  assert.deepEqual(((await worker.request('state.get')) as View).marked, [EDITED])
  const lines = worker.logs.filter((l) => l.includes('save hook'))
  assert.equal(lines.length, 1)
  assert.match(lines[0], /not listed, focused used, inside it yes, focused yes, recorded in the lock yes/)
  assert.equal(worker.logs.some((l) => l.includes(EDITED)), false)
})

test('a save of a Forge file reads the workspace a second later and notifies once', async () => {
  const empty = { ...JSON.parse(fixture('drift-show.json')), files: [] }
  const { s, h, worker } = await setup({ extra: { 'drift show --json': { stdout: JSON.stringify(empty), code: 0 } } })
  const notes = () => (h.callsOf('notifications.show') as { body?: string }[]).filter((n) => String(n.body).includes('send the change'))
  assert.equal(notes().length, 0)
  // The person edits and saves: from now on drift show lists the file.
  const table = JSON.parse(readFileSync(String(s.env.CRAFTAR_STUB_TABLE), 'utf8'))
  table['drift show --json'] = { stdout: fixture('drift-show.json'), code: 1 }
  writeFileSync(String(s.env.CRAFTAR_STUB_TABLE), JSON.stringify(table))
  await worker.hooks.fire('editor.save.before', { workspaceId: 'w1', path: EDITED, text: 'x' })
  await new Promise((r) => setTimeout(r, 1_300))
  await main.settled()
  assert.equal(notes().length, 1)
  assert.match(String(notes()[0].body), /commit-conventions\.md belongs to Forge/)
})

test('a local Forge never gets --forge, and naming a clone is refused for it', async () => {
  const { s, worker } = await setup({ extra: { 'drift promote': { stdout: JSON.stringify(PLAN), code: 0 } } })
  await assert.rejects(worker.request('forge.dir.set', { dir: tempDir('craftar-orca-clone-') }), /on this machine/)
  await sendAndWait(worker, 'send.preview', { path: EDITED })
  assert.equal(s.calls().some((c) => c.argv.includes('--forge')), false)
})

test('the write uses the Forge the dry run used; changing the clone folder drops the plan', async () => {
  const { s, worker } = await setup({ remote: true, extra: { 'drift promote': { stdout: JSON.stringify(PLAN), code: 0 } } })
  const one = tempDir('craftar-orca-clone-')
  await worker.request('forge.dir.set', { dir: one })
  await sendAndWait(worker, 'send.preview', { path: EDITED })
  const two = tempDir('craftar-orca-clone-')
  const v = (await worker.request('forge.dir.set', { dir: two })) as View
  assert.equal(v.send, null)
  await assert.rejects(worker.request('send.run', { path: EDITED }), /look at the plan first/)
  assert.equal(s.calls().filter((c) => c.argv[1] === 'promote').length, 1)
})

test('while a send is checking or writing, another Send or Write is refused', async () => {
  const { worker } = await setup({ extra: { 'drift promote': { stdout: JSON.stringify(PLAN), code: 0, delayMs: 300 } } })
  await worker.request('send.preview', { path: EDITED })
  await assert.rejects(worker.request('send.preview', { path: EDITED }), /craftar is already/)
  await main.settled()
})

test('Change forgets the stored clone folder, and the panel asks for it again', async () => {
  const { worker } = await setup({ remote: true })
  await worker.request('forge.dir.set', { dir: tempDir('craftar-orca-clone-') })
  const v = (await worker.request('forge.dir.set', { dir: '' })) as View
  assert.deepEqual(v.forgeDir, { needed: true, dir: null })
})

test('while the write runs, Change and Cancel are refused, and the write keeps its own result', async () => {
  const { worker } = await setup({ remote: true, extra: { 'drift promote': { stdout: JSON.stringify(PLAN), code: 0, delayMs: 400 } } })
  await worker.request('forge.dir.set', { dir: tempDir('craftar-orca-clone-') })
  await sendAndWait(worker, 'send.preview', { path: EDITED })
  await worker.request('send.run', { path: EDITED })
  await assert.rejects(worker.request('forge.dir.set', { dir: '' }), /craftar is already/)
  await assert.rejects(worker.request('send.cancel', {}), /craftar is already/)
  await main.settled()
  assert.equal(((await worker.request('state.get')) as View).send?.phase, 'done')
})

test('Check again clears a refusal to send, so Send is offered again and craftar answers anew', async () => {
  const { worker } = await setup({ extra: { 'drift promote': { stdout: '', code: 1, stderr: 'error: D16: promote refused\n' } } })
  const v = await sendAndWait(worker, 'send.preview', { path: EDITED })
  assert.equal(v.sendRefused.length, 1)
  await worker.request('state.refresh')
  await main.settled()
  assert.deepEqual(((await worker.request('state.get')) as View).sendRefused, [])
})

test('a click on a file opens it in an editor tab of Orca, in the focused workspace; a path the workspace does not list is refused', async () => {
  const { h, worker } = await setup()
  h.respond('editor.open', { opened: true })
  await worker.request('file.open', { path: EDITED })
  assert.deepEqual(h.callsOf('editor.open'), [{ workspaceId: 'w1', path: EDITED }])
  await assert.rejects(worker.request('file.open', { path: '../outside.md' }), /not a file this workspace lists/)
  assert.equal(h.callsOf('editor.open').length, 1)
})

test('a file the Forge brings that is not here yet is refused by the worker, whatever the panel asks', async () => {
  const { s, h, worker } = await setup()
  const status = JSON.parse(fixture('status.json'))
  status.statuses.push({ path: '.claude/rules/brand-new.md', state: 'new', target: 'claude-code', ingredient: 'rule/brand-new' })
  const table = JSON.parse(readFileSync(s.env.CRAFTAR_STUB_TABLE, 'utf8'))
  table['status --json'] = { stdout: JSON.stringify(status), code: 0 }
  writeFileSync(s.env.CRAFTAR_STUB_TABLE, JSON.stringify(table))
  await worker.request('state.refresh')
  await main.settled()
  await assert.rejects(worker.request('file.open', { path: '.claude/rules/brand-new.md' }), /not a file this workspace lists/)
  assert.equal(h.callsOf('editor.open').length, 0)
})

test("Check again clears only the focused workspace's refusals; another craftar version clears them all", async () => {
  const { s, h, worker, web } = await setup({ extra: { 'drift promote': { stdout: '', code: 1, stderr: 'error: D16: promote refused\n' } } })
  assert.equal((await sendAndWait(worker, 'send.preview', { path: EDITED })).sendRefused.length, 1)
  const api = tempDir('craftar-orca-ws-')
  writeFileSync(join(api, 'craftar.yaml'), 'forge: ../forge\nprofile: acme-web\n')
  h.respond('workspace.list', {
    workspaces: [
      { id: 'w1', kind: 'folder', name: 'web', path: web, branch: 'main', hostId: 'local' },
      { id: 'w2', kind: 'folder', name: 'api', path: api, branch: 'dev', hostId: 'local' },
    ],
    truncated: false,
  })
  const focus = async (name: string, branch: string) => {
    h.respond('workspace.readContext', { branch, displayName: name, terminals: [] })
    await worker.emit('workspace.changed', { context: { branch, displayName: name, terminals: [] } })
    await main.settled()
  }
  await focus('api', 'dev')
  // Check again with api in focus, the same craftar: web keeps its refusal.
  await worker.request('state.refresh')
  await main.settled()
  await focus('web', 'main')
  assert.equal(((await worker.request('state.get')) as View).sendRefused.length, 1)
  // Another craftar version: every refusal is cleared.
  await focus('api', 'dev')
  const table = JSON.parse(readFileSync(s.env.CRAFTAR_STUB_TABLE, 'utf8'))
  table['doctor --json'] = { stdout: JSON.stringify({ ...JSON.parse(fixture('doctor.json')), version: '1.8.0' }), code: 0 }
  writeFileSync(s.env.CRAFTAR_STUB_TABLE, JSON.stringify(table))
  await worker.request('state.refresh')
  await main.settled()
  await focus('web', 'main')
  assert.deepEqual(((await worker.request('state.get')) as View).sendRefused, [])
})
