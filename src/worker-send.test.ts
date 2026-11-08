// S3a, Send to Forge (spec 60 §8, O5, O7): the dry run on the first click, the write on a second; the Forge
// directory asked once for a URL Forge; one notification per newly edited file; the save hook only marks.
import { afterEach, assert, beforeEach, mockHost, mountWorker, test } from 'orca/testing'
import { writeFileSync } from 'node:fs'
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
  params: [], sections: [], flattened: [], dependents: [], nextSync: { counts: { unchanged: 4 } }, impact: { registry: 'read', workspaces: [] }, warnings: [],
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

type View = {
  send: { path: string; phase: string; plan: { outcome: string; written: unknown[] } | null; result: { dryRun: boolean } | null; message: string | null } | null
  forgeDir: { needed: boolean; dir: string | null }
  marked: string[]
}

test('Send runs the dry run first; Write to the Forge runs the write; nothing is written before the second click', async () => {
  const { s, worker, web } = await setup({ extra: { 'drift promote': { stdout: JSON.stringify(PLAN), code: 0 } } })
  const previewed = (await worker.request('send.preview', { path: EDITED })) as View
  assert.equal(previewed.send?.phase, 'preview')
  assert.equal(previewed.send?.plan?.outcome, 'variant')
  const promotes = () => s.calls().filter((c) => c.argv[0] === 'drift' && c.argv[1] === 'promote').map((c) => c.argv)
  assert.deepEqual(promotes(), [['drift', 'promote', EDITED, '--workspace', web, '--dry-run', '--json']])
  const done = (await worker.request('send.run', { path: EDITED })) as View
  assert.equal(done.send?.phase, 'done')
  assert.deepEqual(promotes()[1], ['drift', 'promote', EDITED, '--workspace', web, '--json'])
})

test('Write to the Forge without a dry run of that file first is refused, and nothing runs', async () => {
  const { s, worker } = await setup({ extra: { 'drift promote': { stdout: JSON.stringify(PLAN), code: 0 } } })
  await assert.rejects(worker.request('send.run', { path: EDITED }), /look at the plan first/)
  assert.equal(s.calls().some((c) => c.argv[1] === 'promote'), false)
})

test("a file the workspace does not list as promotable is refused; craftar's refusal of a dry run is shown in its words", async () => {
  const { worker } = await setup({ extra: { 'drift promote': { stdout: '', code: 1, stderr: 'error: D16: promote refused\n' } } })
  await assert.rejects(worker.request('send.preview', { path: '.claude/rules/other.md' }), /not a file this workspace can send/)
  const v = (await worker.request('send.preview', { path: EDITED })) as View
  assert.deepEqual([v.send?.phase, v.send?.message], ['error', 'error: D16: promote refused'])
})

test('a URL Forge needs a local clone named once: before it, Send says so; after it, --forge is passed', async () => {
  const { s, h, worker, web } = await setup({ remote: true, extra: { 'drift promote': { stdout: JSON.stringify(PLAN), code: 0 } } })
  let v = (await worker.request('state.get')) as View
  assert.deepEqual(v.forgeDir, { needed: true, dir: null })
  await assert.rejects(worker.request('send.preview', { path: EDITED }), /local clone of the Forge/)
  const clone = tempDir('craftar-orca-clone-')
  v = (await worker.request('forge.dir.set', { dir: clone })) as View
  assert.deepEqual(v.forgeDir, { needed: true, dir: clone })
  await worker.request('send.preview', { path: EDITED })
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
  assert.equal(shown[0].body, `${EDITED} belongs to Forge ../forge2 — send the change to the Forge? Open the craftar panel.`)
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
