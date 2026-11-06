// The S0 worker: its status bar item, its heartbeat and the probe command (spec 60 §12).
import { afterEach, assert, mockHost, mountWorker, test } from 'orca/testing'
import { chmodSync, copyFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { removeTempDirs, tempDir } from '../test-support/tmp'
import * as main from './worker'

afterEach(removeTempDirs)

const CAPS = [
  'workspace:read',
  'workspace:write',
  'terminal:send',
  'terminal:read',
  'notifications:show',
  'storage:own',
  'settings:own',
]

// A stub `craftar`: a copy of node under that name. `craftar --version` then prints node's version,
// which is all S0 needs; no test starts the person's own craftar (spec 60 §15).
function stubCraftar(...under: string[]): string {
  const dir = join(tempDir('craftar-orca-stub-'), ...under)
  mkdirSync(dir, { recursive: true })
  const file = join(dir, process.platform === 'win32' ? 'craftar.exe' : 'craftar')
  copyFileSync(process.execPath, file)
  if (process.platform !== 'win32') chmodSync(file, 0o755)
  return file
}

type Ws = { id: string; kind: string; name: string; path: string; branch: string | null; hostId: string | null }
const ACME: Ws = { id: 'w1', kind: 'folder', name: 'acme-portal', path: '/tmp/acme-portal', branch: 'main', hostId: null }

function host(settings: Record<string, string | number | boolean>, workspaces: Ws[] = [ACME], terminalLines = ['$ echo craftar-probe', 'craftar-probe']) {
  return mockHost({
    capabilities: CAPS,
    settings,
    results: {
      'workspace.list': { workspaces, truncated: false },
      'workspace.readContext': { branch: 'main', displayName: 'acme-portal', terminals: [] },
      'terminal.create': { terminalId: 't1' },
      'terminal.read': { lines: terminalLines, truncated: false },
    },
  })
}

test('activating shows the status bar item and records a heartbeat of timestamps and a counter only', async () => {
  const h = host({ craftarPath: '' })
  const worker = await mountWorker(main, { host: h, commands: ['craftar.probe'] })
  assert.equal(h.callsOf('statusBar.update').length >= 1, true)
  await worker.command('craftar.probe') // the probe waits for the first heartbeat
  const hb = h.data().storage['probe.heartbeat'] as Record<string, unknown>
  assert.deepEqual(Object.keys(hb).sort(), ['last', 'startedAt', 'ticks'])
  assert.deepEqual(worker.refusals, [])
  await worker.deactivate()
})

test('the probe reports the craftar it found, its version and the terminal it opened', async () => {
  const stub = stubCraftar()
  const h = host({ craftarPath: stub, craftarHome: '' })
  const worker = await mountWorker(main, { host: h, commands: ['craftar.probe'] })
  const report = String(await worker.command('craftar.probe'))
  assert.match(report, /craftar: found/)
  assert.match(report, new RegExp(`version: ${process.version.replace(/\./g, '\\.')}`))
  assert.match(report, /terminal: craftar-probe seen/)
  assert.match(report, /notifications\.show: no action \(host-api 1\.3\)/)
  const created = h.callsOf('terminal.create')
  assert.equal(created.length, 1)
  assert.deepEqual(created[0], { workspaceId: 'w1', title: 'craftar probe', command: 'echo craftar-probe' })
  assert.equal(h.callsOf('terminal.sendText').length, 0)
  assert.deepEqual(worker.refusals, [])
  await worker.deactivate()
})

test('the probe names where CRAFTAR_HOME comes from, never its value', async () => {
  const stub = stubCraftar()
  const home = '/tmp/acme-home-' + 'z'.repeat(12)
  const h = host({ craftarPath: stub, craftarHome: home })
  const worker = await mountWorker(main, { host: h, commands: ['craftar.probe'] })
  const report = String(await worker.command('craftar.probe'))
  assert.match(report, /CRAFTAR_HOME: set from the setting/)
  assert.equal(report.includes(home), false)
  assert.equal(worker.logs.some((l) => l.includes(home)), false)
  await worker.deactivate()
})

test('a worker environment variable is reported as present, never by its value', async () => {
  const sentinel = 'ghp_' + 'q'.repeat(36)
  const before = process.env.GH_TOKEN
  process.env.GH_TOKEN = sentinel
  try {
    const h = host({ craftarPath: stubCraftar() })
    const worker = await mountWorker(main, { host: h, commands: ['craftar.probe'] })
    const report = String(await worker.command('craftar.probe'))
    assert.match(report, /GH_TOKEN present/)
    assert.equal(report.includes(sentinel), false)
    assert.equal(worker.logs.some((l) => l.includes(sentinel)), false)
    await worker.deactivate()
  } finally {
    if (before === undefined) delete process.env.GH_TOKEN
    else process.env.GH_TOKEN = before
  }
})

test('the terminal lines are shown in the report and never logged', async () => {
  const marker = 'acme-user@acme-host:/tmp/acme-portal$'
  const h = host({ craftarPath: stubCraftar() }, [ACME], [marker + ' echo craftar-probe', 'craftar-probe'])
  const worker = await mountWorker(main, { host: h, commands: ['craftar.probe'] })
  const report = String(await worker.command('craftar.probe'))
  assert.equal(report.includes(marker), true)
  assert.equal(worker.logs.some((l) => l.includes(marker)), false)
  await worker.deactivate()
})

test('a craftar under a version manager shim directory is named as such', async () => {
  const h = host({ craftarPath: stubCraftar('.asdf', 'shims') })
  const worker = await mountWorker(main, { host: h, commands: ['craftar.probe'] })
  const report = String(await worker.command('craftar.probe'))
  assert.match(report, /under the asdf shim directory/)
  await worker.deactivate()
})

test('with no single local workspace the probe opens no terminal and says why', async () => {
  const other: Ws = { ...ACME, id: 'w2', name: 'acme-api', branch: 'dev' }
  const remote: Ws = { ...ACME, id: 'w3', hostId: 'ssh-1' }
  const h = host({ craftarPath: stubCraftar() }, [{ ...ACME, name: 'acme-web' }, other, remote])
  const worker = await mountWorker(main, { host: h, commands: ['craftar.probe'] })
  const report = String(await worker.command('craftar.probe'))
  assert.match(report, /terminal: not opened/)
  assert.equal(h.callsOf('terminal.create').length, 0)
  await worker.deactivate()
})

test('a craftar that cannot be found is reported and nothing is started', async () => {
  const h = host({ craftarPath: 'not/absolute' })
  const worker = await mountWorker(main, { host: h, commands: ['craftar.probe'] })
  const report = String(await worker.command('craftar.probe'))
  assert.match(report, /craftar: not found — craftarPath must be an absolute path/)
  assert.doesNotMatch(report, /version:/)
  await worker.deactivate()
})
