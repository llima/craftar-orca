// The S0 worker: its status bar item, its heartbeat and the probe command (spec 60 §12).
import { assert, mockHost, mountWorker, test } from 'orca/testing'
import { chmodSync, copyFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as main from './worker'

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
function stubCraftar(): string {
  const dir = mkdtempSync(join(tmpdir(), 'craftar-orca-stub-'))
  const file = join(dir, process.platform === 'win32' ? 'craftar.exe' : 'craftar')
  copyFileSync(process.execPath, file)
  if (process.platform !== 'win32') chmodSync(file, 0o755)
  return file
}

function host(settings: Record<string, string | number | boolean>) {
  return mockHost({
    capabilities: CAPS,
    settings,
    results: {
      'workspace.list': {
        workspaces: [{ id: 'w1', kind: 'folder', name: 'acme-portal', path: '/tmp/acme-portal', branch: 'main', hostId: null }],
        truncated: false,
      },
      'workspace.readContext': { branch: 'main', displayName: 'acme-portal', terminals: [] },
      'terminal.create': { terminalId: 't1' },
      'terminal.read': { lines: ['$ echo craftar-probe', 'craftar-probe'], truncated: false },
    },
  })
}

test('activating shows the status bar item', async () => {
  const h = host({ craftarPath: '' })
  const worker = await mountWorker(main, { host: h, commands: ['craftar.probe'] })
  const updates = h.callsOf('statusBar.update')
  assert.equal(updates.length >= 1, true)
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

test('the probe starts craftar with an argument array and CRAFTAR_HOME from the setting', async () => {
  const stub = stubCraftar()
  const h = host({ craftarPath: stub, craftarHome: '/tmp/acme-home' })
  const worker = await mountWorker(main, { host: h, commands: ['craftar.probe'] })
  const report = String(await worker.command('craftar.probe'))
  assert.match(report, /CRAFTAR_HOME: set from the setting/)
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
