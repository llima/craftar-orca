// Send all (the user's design A of 2026-11-08): the dry runs of every file and one plan; Write all writes them in order and
// stops at the first refusal, in craftar's words; one PR for what was written, and Send the rest after its commit, on the
// same branch. Every craftar is a stub; every git command goes through a terminal the plugin opens, never typed.
import { afterEach, assert, beforeEach, mockHost, mountWorker, test } from 'orca/testing'
import { readFileSync, writeFileSync } from 'node:fs'
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

const A = '.claude/rules/commit-conventions.md'
const B = '.claude/rules/frontend-react.md'
const plan = (path: string, name: string, dryRun: boolean) => ({
  workspace: '', forge: '/home/acme/forge2', profile: 'acme-web', dryRun, path, ingredient: `rule/${name}`,
  outcome: 'variant', promoted: `rule/${name}--acme-web`, written: [{ path: `ingredients/rules/${name}--acme-web/rule.md`, action: 'created' }, { path: 'recipes/base--acme-web.yaml', action: 'edited' }],
  params: [], sections: [], flattened: { params: [], sections: [] }, dependents: [], nextSync: { counts: { unchanged: 4 } }, impact: { registry: 'read', workspaces: [] }, warnings: [],
})
const GATE = 'error: recipes/base--acme-web.yaml is not held by git (changed and not committed): commit it, then run drift promote again'

function docs() {
  const status = JSON.parse(fixture('status.json'))
  status.statuses = status.statuses.map((x: { path: string; state: string }) => (x.path === B ? { ...x, state: 'drift' } : x))
  const drift = JSON.parse(fixture('drift-show.json'))
  drift.files.push({ ...drift.files[0], path: B, ingredient: 'rule/frontend-react' })
  return { status, drift }
}

function table(web: string, over: Record<string, unknown> = {}) {
  const { status, drift } = docs()
  return {
    'doctor --json': { stdout: fixture('doctor.json'), code: 0 },
    'workspaces --json': { stdout: fixture('workspaces.json'), code: 0 },
    'status --json': { stdout: JSON.stringify(status), code: 0 },
    'drift show --json': { stdout: JSON.stringify(drift), code: 1 },
    'repos --json': { stdout: fixture('repos.json'), code: 0 },
    [`drift promote ${A}`]: { stdout: JSON.stringify(plan(A, 'commit-conventions', true)), code: 0 },
    [`drift promote ${B}`]: { stdout: JSON.stringify(plan(B, 'frontend-react', true)), code: 0 },
    [`drift promote ${A} --workspace ${web} --json`]: { stdout: JSON.stringify(plan(A, 'commit-conventions', false)), code: 0 },
    [`drift promote ${B} --workspace ${web} --json`]: { stdout: JSON.stringify(plan(B, 'frontend-react', false)), code: 0 },
    ...over,
  }
}

async function setup(over: (web: string) => Record<string, unknown> = () => ({})) {
  const s = stubCraftar({})
  const web = tempDir('craftar-orca-ws-')
  writeFileSync(join(web, 'craftar.yaml'), 'forge: ../forge\nprofile: acme-web\n')
  writeFileSync(String(s.env.CRAFTAR_STUB_TABLE), JSON.stringify(table(web, over(web))))
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
  const retable = (more: Record<string, unknown>) => writeFileSync(String(s.env.CRAFTAR_STUB_TABLE), JSON.stringify({ ...JSON.parse(readFileSync(String(s.env.CRAFTAR_STUB_TABLE), 'utf8')), ...more }))
  return { s, h, worker, web, retable }
}

type W = { request: (n: string, d?: unknown) => Promise<unknown> }
const state = async (worker: W) => (await worker.request('state.get')) as View
const promotes = (s: { calls: () => { argv: string[] }[] }) => s.calls().filter((c) => c.argv[0] === 'drift' && c.argv[1] === 'promote').map((c) => `${c.argv.includes('--dry-run') ? 'dry' : 'write'} ${c.argv[2]}`)

test('Send all: every dry run first, one plan; Write all writes them in order, then the workspace is read again', async () => {
  const { s, worker } = await setup()
  await worker.request('sendall.preview')
  await main.settled()
  let v = await state(worker)
  assert.equal(v.sendAll?.phase, 'plan')
  assert.deepEqual(v.sendAll?.items.map((x) => [x.path, x.plan?.promoted ?? null, x.refused]), [[A, 'rule/commit-conventions--acme-web', null], [B, 'rule/frontend-react--acme-web', null]])
  assert.deepEqual(promotes(s), [`dry ${A}`, `dry ${B}`], 'nothing is written before Write all')
  await assert.rejects(worker.request('sendall.run', { paths: [B, A] }), /changed since the panel showed them/)
  await assert.rejects(worker.request('sendall.run', { paths: [A] }), /changed since the panel showed them/)
  const reads = s.calls().filter((c) => c.argv[0] === 'status').length
  await worker.request('sendall.run', { paths: [A, B] })
  await main.settled()
  v = await state(worker)
  assert.equal(v.sendAll?.phase, 'done')
  assert.deepEqual(v.sendAll?.items.map((x) => x.result?.dryRun), [false, false])
  assert.deepEqual(promotes(s), [`dry ${A}`, `dry ${B}`, `write ${A}`, `write ${B}`])
  assert.equal(s.calls().filter((c) => c.argv[0] === 'status').length, reads + 1, 'one read after the batch, not one per file')
  // The writes carried no --overwrite-drift and went through argument arrays (the stub records argv as given).
  assert.equal(s.calls().some((c) => c.argv.includes('--overwrite-drift')), false)
})

test('the first refusal stops the batch in craftar\'s words; one PR for what was written; Send the rest commits on the same branch', async () => {
  const { s, h, worker, web, retable } = await setup((ws) => ({ [`drift promote ${B} --workspace ${ws} --json`]: { stdout: '', stderr: GATE, code: 1 } }))
  await worker.request('sendall.preview')
  await main.settled()
  await worker.request('sendall.run', { paths: [A, B] })
  await main.settled()
  let v = await state(worker)
  assert.equal(v.sendAll?.phase, 'stopped')
  assert.deepEqual(v.sendAll?.stopped, { path: B, message: GATE })
  assert.deepEqual(v.sendAll?.remaining, [B])
  assert.equal(v.sendAll?.items[0].result?.promoted, 'rule/commit-conventions--acme-web')
  assert.equal(v.sendAll?.items[1].result, null)
  // A gate refusal of a write is not a refusal of the file: it is not kept as "craftar will not send it".
  assert.deepEqual(v.sendRefused, [])
  // The PR for what was written.
  h.respond('terminal.read', { lines: ['craftar-shell:/bin/bash', 'Acme Dev <dev@acme.example> 1 +0000', 'craftar-branch:main', marker('prepare', 'n1', true)], truncated: false })
  await worker.request('forgepr.prepare')
  await main.settled()
  v = await state(worker)
  assert.equal(v.sendAll, null)
  assert.equal(v.forgePr?.phase, 'ready')
  assert.deepEqual(v.forgePr?.rest, [B])
  assert.deepEqual(v.forgePr?.paths, ['ingredients/rules/commit-conventions--acme-web/rule.md', 'recipes/base--acme-web.yaml'])
  await assert.rejects(worker.request('sendall.rest'), /nothing is left to send/, 'Send the rest waits for the commit')
  h.respond('terminal.read', { lines: ['Acme Dev <dev@acme.example> 0 +0000', marker('commit', 'n1', true)], truncated: false })
  await worker.request('forgepr.step', { step: 'commit' })
  await main.settled()
  assert.equal((await state(worker)).forgePr?.phase, 'committed')
  const first = (h.callsOf('terminal.create').at(-1) as { command: string }).command
  assert.match(first, / switch -c craftar-acme-web-commit-conventions /)
  // Committed: the gate clears, and the rest is planned and written again.
  retable({ [`drift promote ${B} --workspace ${web} --json`]: { stdout: JSON.stringify(plan(B, 'frontend-react', false)), code: 0 } })
  await worker.request('sendall.rest')
  await main.settled()
  v = await state(worker)
  assert.equal(v.sendAll?.phase, 'plan')
  assert.equal(v.sendAll?.more, true)
  assert.equal(v.forgePr?.open, false, 'the PR waits behind the rest')
  await worker.request('sendall.run', { paths: [B] })
  await main.settled()
  assert.equal((await state(worker)).sendAll?.phase, 'done')
  h.respond('terminal.read', { lines: ['Acme Dev <dev@acme.example> 0 +0000', marker('commit', 'n1', true)], truncated: false })
  await worker.request('forgepr.more')
  await main.settled()
  v = await state(worker)
  assert.equal(v.forgePr?.phase, 'committed')
  assert.deepEqual(v.forgePr?.rest, [])
  assert.equal(v.sendAll, null)
  const second = (h.callsOf('terminal.create').at(-1) as { command: string }).command
  assert.match(second, / switch craftar-acme-web-commit-conventions /, 'the same branch, never a new one')
  assert.doesNotMatch(second, /switch -c/)
  // Exactly the paths the rest wrote.
  assert.match(second, /add -- 'ingredients\/rules\/frontend-react--acme-web\/rule\.md' 'recipes\/base--acme-web\.yaml' &&/)
  assert.doesNotMatch(second, /commit-conventions--acme-web\/rule\.md/)
  // The PR body names both sends: refs and paths only.
  assert.match(v.forgePr?.body ?? '', /2 changes: variant, rule\/commit-conventions--acme-web .*; variant, rule\/frontend-react--acme-web/)
  assert.deepEqual(promotes(s), [`dry ${A}`, `dry ${B}`, `write ${A}`, `write ${B}`, `dry ${B}`, `write ${B}`])
})

test('a dry run craftar refuses keeps that file here in its words; Write all carries only the others', async () => {
  const { s, worker } = await setup(() => ({ [`drift promote ${B}`]: { stdout: '', stderr: 'error: D16: promote refused', code: 1 } }))
  await worker.request('sendall.preview')
  await main.settled()
  const v = await state(worker)
  assert.equal(v.sendAll?.phase, 'plan')
  assert.equal(v.sendAll?.items[1].refused, 'error: D16: promote refused')
  assert.deepEqual(v.sendRefused, [{ path: B, message: 'error: D16: promote refused' }])
  await worker.request('sendall.run', { paths: [A] })
  await main.settled()
  assert.deepEqual(promotes(s), [`dry ${A}`, `dry ${B}`, `write ${A}`])
  assert.equal((await state(worker)).sendAll?.phase, 'done')
})

test('one send at a time: a single Send waits for Send all, Cancel does not stop a write, and a PR in progress comes first', async () => {
  const { h, worker, web } = await setup((ws) => ({ [`drift promote ${A} --workspace ${ws} --json`]: { stdout: JSON.stringify(plan(A, 'commit-conventions', false)), code: 0, delayMs: 400 } }))
  await worker.request('sendall.preview')
  await main.settled()
  await worker.request('sendall.run', { paths: [A, B] })
  await assert.rejects(worker.request('send.preview', { path: A }), /already working on a send/)
  await assert.rejects(worker.request('sendall.preview'), /already working on a send/)
  await assert.rejects(worker.request('sendall.cancel'), /writing the Forge/)
  await main.settled()
  h.respond('terminal.read', { lines: ['craftar-shell:/bin/bash', 'Acme Dev <dev@acme.example> 1 +0000', 'craftar-branch:main', marker('prepare', 'n1', true)], truncated: false })
  await worker.request('forgepr.prepare')
  await main.settled()
  await assert.rejects(worker.request('sendall.preview'), /Forge PR is being prepared/)
  void web
})

test('Cancel during the dry runs drops their late results', async () => {
  const { worker } = await setup(() => ({ [`drift promote ${A}`]: { stdout: JSON.stringify(plan(A, 'commit-conventions', true)), code: 0, delayMs: 300 } }))
  await worker.request('sendall.preview')
  await worker.request('sendall.cancel')
  await main.settled()
  assert.equal((await state(worker)).sendAll, null)
})
