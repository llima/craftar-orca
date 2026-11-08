// S3b in the worker: after a Send wrote the Forge, the PR in three clicks, each in a new visible terminal with a fixed command;
// the plugin follows each step by its marker, keeps only the identity, the branch and the PR URL, and never commits itself.
import { afterEach, assert, beforeEach, mockHost, mountWorker, test } from 'orca/testing'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { removeTempDirs, tempDir } from '../test-support/tmp'
import { fixture, stubCraftar } from '../test-support/stub-craftar'
import { marker } from './forge-pr'
import * as main from './worker'
import type { View } from './worker'

const CAPS = ['workspace:read', 'workspace:write', 'terminal:send', 'terminal:read', 'notifications:show', 'storage:own', 'settings:own']
const workers: { deactivate: () => Promise<void> | void }[] = []
let savedPath: string | undefined
beforeEach(() => {
  savedPath = process.env.PATH
  process.env.PATH = tempDir('craftar-orca-path-')
  main.__forgePrTiming(5, 200, () => 'n1')
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

async function setup() {
  const s = stubCraftar({
    'doctor --json': { stdout: fixture('doctor.json'), code: 0 },
    'workspaces --json': { stdout: fixture('workspaces.json'), code: 0 },
    'status --json': { stdout: fixture('status.json'), code: 0 },
    'drift show --json': { stdout: fixture('drift-show.json'), code: 1 },
    'repos --json': { stdout: fixture('repos.json'), code: 0 },
    'drift promote': { stdout: JSON.stringify(PLAN), code: 0 },
  })
  const web = tempDir('craftar-orca-ws-')
  writeFileSync(join(web, 'craftar.yaml'), 'forge: ../forge\nprofile: acme-web\n')
  const h = mockHost({
    capabilities: CAPS,
    settings: { craftarPath: s.bin, craftarHome: '', intervalMinutes: 5, fetch: true },
    results: {
      'workspace.list': { workspaces: [{ id: 'w1', kind: 'folder', name: 'web', path: web, branch: 'main', hostId: 'local' }], truncated: false },
      'workspace.readContext': { branch: 'main', displayName: 'web', terminals: [] },
      'terminal.create': { terminalId: 't1' },
      'terminal.read': { lines: [], truncated: false },
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

async function sent(worker: { request: (n: string, d?: unknown) => Promise<unknown> }) {
  await worker.request('send.preview', { path: EDITED })
  await main.settled()
  await worker.request('send.run', { path: EDITED })
  await main.settled()
}

const get = async (worker: { request: (n: string) => Promise<unknown> }) => ((await worker.request('state.get')) as View).forgePr

test('the three steps, in order, each a new terminal with a fixed command; the identity and branch are read in a terminal like the commit\'s', async () => {
  const { h, worker } = await setup()
  await sent(worker)
  await assert.rejects(worker.request('forgepr.step', { step: 'commit' }), /no Forge PR/)
  // The shell check and the preview answer from the terminals.
  h.respond('terminal.read', { lines: ['craftar-shell:/bin/bash', 'Acme Dev <dev@acme.example> 1794150445 -0300', 'craftar-branch:main', marker('prepare', 'n1', true)], truncated: false })
  await worker.request('forgepr.prepare')
  await main.settled()
  let f = await get(worker)
  assert.equal(f?.phase, 'ready')
  assert.equal(f?.identity, 'Acme Dev <dev@acme.example>')
  assert.equal(f?.forgeBranch, 'main')
  assert.equal(f?.branch, 'craftar-acme-web-commit-conventions')
  assert.deepEqual(f?.paths, ['ingredients/rules/commit-conventions--acme-web/rule.md'])
  // Out of order: refused.
  await assert.rejects(worker.request('forgepr.step', { step: 'push' }), /waits for the one before it/)
  await assert.rejects(worker.request('forgepr.step', { step: 'commit', branch: 'Bad Branch' }), /lowercase letters/)
  h.respond('terminal.read', { lines: ['Acme Dev <dev@acme.example> 0 +0000', marker('commit', 'n1', true)], truncated: false })
  await worker.request('forgepr.step', { step: 'commit', title: 'chore(forge): my title' })
  await main.settled()
  f = await get(worker)
  assert.equal(f?.phase, 'committed')
  assert.equal(f?.title, 'chore(forge): my title')
  assert.equal(f?.authorDiffers, null)
  h.respond('terminal.read', { lines: [marker('push', 'n1', true)], truncated: false })
  await worker.request('forgepr.step', { step: 'push' })
  await main.settled()
  assert.equal((await get(worker))?.phase, 'pushed')
  h.respond('terminal.read', { lines: ['https://github.com/acme/forge2/pull/3', marker('pr', 'n1', true)], truncated: false })
  await worker.request('forgepr.step', { step: 'pr' })
  await main.settled()
  f = await get(worker)
  assert.equal(f?.phase, 'opened')
  // No origin to read here (no git on PATH): the URL is not guessed, and the panel says to copy it.
  assert.equal(f?.url, null)
  assert.match(f?.note ?? '', /copy it from there/)
  // Every command went through terminal.create, never typed; the worker started no git commit of its own.
  const titles = h.callsOf('terminal.create').map((c) => (c as { title: string }).title)
  assert.deepEqual(titles, ['craftar shell check', 'craftar forge PR: prepare', 'craftar forge PR: commit', 'craftar forge PR: push', 'craftar forge PR: pr'])
  const commit = (h.callsOf('terminal.create')[2] as { command: string }).command
  assert.match(commit, /commit -m 'chore\(forge\): my title' -- 'ingredients\/rules\/commit-conventions--acme-web\/rule\.md'/)
  // Nothing of the terminals is stored.
  assert.ok(!JSON.stringify(h.data().storage).includes('Acme Dev'))
})

test('a failed step says so and can be tried again; a terminal that says nothing waits, then Check the terminal reads it again', async () => {
  const { h, worker } = await setup()
  await sent(worker)
  h.respond('terminal.read', { lines: ['craftar-shell:/bin/bash', 'Acme Dev <dev@acme.example> 1 +0000', 'craftar-branch:main', marker('prepare', 'n1', true)], truncated: false })
  await worker.request('forgepr.prepare')
  await main.settled()
  h.respond('terminal.read', { lines: [marker('commit', 'n1', false)], truncated: false })
  await worker.request('forgepr.step', { step: 'commit' })
  await main.settled()
  let f = await get(worker)
  assert.equal(f?.phase, 'failed')
  assert.equal(f?.step, 'commit')
  h.respond('terminal.read', { lines: ['Someone Else <x@acme.example> 0 +0000', marker('commit', 'n1', true)], truncated: false })
  await worker.request('forgepr.step', { step: 'commit' })
  await main.settled()
  f = await get(worker)
  assert.equal(f?.phase, 'committed')
  assert.equal(f?.authorDiffers, 'Someone Else <x@acme.example>')
  h.respond('terminal.read', { lines: ['Username for https://github.com:'], truncated: false })
  await worker.request('forgepr.step', { step: 'push' })
  await main.settled()
  f = await get(worker)
  assert.equal(f?.waiting, true)
  assert.equal(f?.phase, 'pushing')
  h.respond('terminal.read', { lines: [marker('push', 'n1', true)], truncated: false })
  await worker.request('forgepr.check')
  await main.settled()
  assert.equal((await get(worker))?.phase, 'pushed')
})

test('a shell the plugin does not quote for gets the steps in words and no terminal; Back keeps the steps, Drop leaves them', async () => {
  const { h, worker } = await setup()
  await sent(worker)
  h.respond('terminal.read', { lines: ['craftar-shell:$0'], truncated: false })
  await worker.request('forgepr.prepare')
  await main.settled()
  let f = await get(worker)
  assert.equal(f?.phase, 'words')
  assert.ok(f?.steps.some((x) => /add and commit exactly these paths/.test(x)))
  assert.equal(h.callsOf('terminal.create').filter((c) => /forge PR/.test((c as { title: string }).title)).length, 0)
  await worker.request('forgepr.show', { open: false })
  f = await get(worker)
  assert.equal(f?.open, false)
  await worker.request('forgepr.drop')
  assert.equal(await get(worker), null)
})
