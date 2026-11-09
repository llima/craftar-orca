// The worker's side of the bell (the user's requests of 2026-11-08): × kept in memory only, Clear stored as a digest
// only, Validate running the self-check and the probe on demand with no notification; and a reused registry's lines.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { afterEach, beforeEach, mockHost, mountWorker } from 'orca/testing'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { removeTempDirs, tempDir } from '../test-support/tmp'
import { fixture, stubCraftar, writeTable } from '../test-support/stub-craftar'
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
  await removeTempDirs()
})

const WARNING = 'agents-md: 1 skill ingredient(s) have no AGENTS.md equivalent — skipped: skill/x'

function craftarDir(): string {
  const dir = tempDir('craftar-orca-ws-')
  writeFileSync(join(dir, 'craftar.yaml'), 'forge: ../forge\nprofile: acme-web\n')
  return dir
}

function table(extra: Record<string, unknown> = {}) {
  const status = { ...JSON.parse(fixture('status.json')), warnings: [WARNING] }
  return {
    'doctor --json': { stdout: fixture('doctor.json'), code: 0 },
    'workspaces --json': { stdout: fixture('workspaces.json'), code: 0 },
    'status --json': { stdout: JSON.stringify(status), code: 0 },
    'drift show --json': { stdout: fixture('drift-show.json'), code: 1 },
    'repos --json': { stdout: fixture('repos.json'), code: 0 },
    ...extra,
  }
}

async function setup(rows?: (web: string) => unknown[]) {
  const s = stubCraftar(table())
  const web = craftarDir()
  const h = mockHost({
    capabilities: CAPS,
    settings: { craftarPath: s.bin, craftarHome: '', intervalMinutes: 15, fetch: true },
    results: {
      'workspace.list': { workspaces: rows ? rows(web) : [{ id: 'w1', kind: 'folder', name: 'web', path: web, branch: 'main', hostId: null }], truncated: false },
      'workspace.readContext': { branch: 'main', displayName: 'web', terminals: [] },
      'terminal.create': { terminalId: 't1' },
      'terminal.read': { lines: ['$ echo craftar-probe', 'craftar-probe'], truncated: false },
    },
  })
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
  return { s, h, worker, web }
}

test('× is remembered in memory only: the view lists the key, storage holds nothing of it', async () => {
  const { h, worker } = await setup()
  const key = 'send-refused\u0000/home/acme/web\u0000error: D17'
  const v = (await worker.request('card.dismiss', { key })) as View
  assert.deepEqual(v.dismissed, [key])
  assert.ok(!JSON.stringify(h.data().storage).includes('D17'))
  await assert.rejects(worker.request('card.dismiss', { key: 3 }), /not a card/)
})

test('Clear stores a digest of the messages per workspace, never their text; a different message brings them back', async () => {
  const { s, h, worker, web } = await setup()
  assert.equal(((await worker.request('state.get')) as View).messagesCleared, false)
  const v = (await worker.request('messages.clear')) as View
  assert.equal(v.messagesCleared, true)
  const stored = h.data().storage['messages.cleared'] as Record<string, string>
  assert.deepEqual(Object.keys(stored), [web])
  assert.match(stored[web], /^[0-9a-f]{64}$/)
  assert.ok(!JSON.stringify(h.data().storage).includes('AGENTS.md'))
  // craftar says something different: the digest no longer matches.
  const status = { ...JSON.parse(fixture('status.json')), warnings: [WARNING, 'plan: a new line'] }
  writeTable(s.env.CRAFTAR_STUB_TABLE!, table({ 'status --json': { stdout: JSON.stringify(status), code: 0 } }))
  await worker.request('state.refresh')
  await main.settled()
  assert.equal(((await worker.request('state.get')) as View).messagesCleared, false)
})

test('Validate runs the self-check again and the probe, shows no notification, and puts both in the report', async () => {
  const { s, h, worker } = await setup()
  const doctors = s.calls().filter((c) => c.argv[0] === 'doctor').length
  const busy = (await worker.request('validate.run')) as View
  assert.equal(busy.validating, true)
  await main.settled()
  const v = (await worker.request('state.get')) as View
  assert.equal(v.validating, false)
  assert.equal(s.calls().filter((c) => c.argv[0] === 'doctor').length, doctors + 1)
  assert.equal(v.probe?.lines[0], 'self-check')
  assert.ok(v.probe?.lines.some((l) => l.startsWith('craftar probe')))
  assert.equal(h.callsOf('notifications.show').filter((n) => (n as { title?: string }).title === 'craftar probe').length, 0)
  assert.equal(h.callsOf('terminal.create').length, 1)
})

test("a reused registry leaves out this workspace's own lines, which status just said fresh, and keeps the others", async () => {
  const api = craftarDir()
  const { s, h, worker, web } = await setup((w) => [
    { id: 'w1', kind: 'folder', name: 'web', path: w, branch: 'main', hostId: null },
    { id: 'w2', kind: 'folder', name: 'api', path: api, branch: 'dev', hostId: null },
  ])
  const registry = { ...JSON.parse(fixture('workspaces.json')), warnings: [`${web}: an old line about web`, 'a line about the machine'] }
  writeTable(s.env.CRAFTAR_STUB_TABLE!, table({ 'workspaces --json': { stdout: JSON.stringify(registry), code: 0 } }))
  h.respond('workspace.readContext', { branch: 'dev', displayName: 'api', terminals: [] })
  await worker.emit('workspace.changed', { context: { branch: 'dev', displayName: 'api', terminals: [] } })
  await main.settled()
  h.respond('workspace.readContext', { branch: 'main', displayName: 'web', terminals: [] })
  await worker.emit('workspace.changed', { context: { branch: 'main', displayName: 'web', terminals: [] } })
  await main.settled()
  const m = ((await worker.request('state.get')) as View).model
  assert.equal(m?.ws, web)
  assert.ok(m?.warnings.includes('a line about the machine'))
  assert.ok(!m?.warnings.some((w) => w.includes('an old line about web')))
})
