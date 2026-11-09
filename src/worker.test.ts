// The S0 worker: its status bar item, its heartbeat and the probe command (spec 60 §12).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { afterEach, beforeEach, mockHost, mountWorker } from 'orca/testing'
import { chmodSync, copyFileSync, mkdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { removeTempDirs, tempDir } from '../test-support/tmp'
import * as main from './worker'

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
  const h = host({ craftarPath: 'not/absolute' })
  const worker = await mountWorker(main, { host: h, commands: ['craftar.probe', 'craftar.open'] })
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
  const worker = await mountWorker(main, { host: h, commands: ['craftar.probe', 'craftar.open'] })
  const report = String(await worker.command('craftar.probe'))
  assert.match(report, /craftar: found/)
  assert.match(report, new RegExp(`version: ${process.version.replace(/\./g, '\\.')}`))
  assert.match(report, /terminal: craftar-probe seen/)
  assert.match(report, /notifications\.show: delivered \(host-api 1\.3: a notification has no action/)
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
  const worker = await mountWorker(main, { host: h, commands: ['craftar.probe', 'craftar.open'] })
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
    const worker = await mountWorker(main, { host: h, commands: ['craftar.probe', 'craftar.open'] })
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
  const worker = await mountWorker(main, { host: h, commands: ['craftar.probe', 'craftar.open'] })
  const report = String(await worker.command('craftar.probe'))
  assert.equal(report.includes(marker), true)
  assert.equal(worker.logs.some((l) => l.includes(marker)), false)
  await worker.deactivate()
})

test('a craftar under a version manager shim directory is named as such', async () => {
  const h = host({ craftarPath: stubCraftar('.asdf', 'shims') })
  const worker = await mountWorker(main, { host: h, commands: ['craftar.probe', 'craftar.open'] })
  const report = String(await worker.command('craftar.probe'))
  assert.match(report, /under the asdf shim directory/)
  await worker.deactivate()
})

test('with no single local workspace the probe opens no terminal and says why', async () => {
  const other: Ws = { ...ACME, id: 'w2', name: 'acme-api', branch: 'dev' }
  const remote: Ws = { ...ACME, id: 'w3', hostId: 'ssh-1' }
  const h = host({ craftarPath: stubCraftar() }, [{ ...ACME, name: 'acme-web' }, other, remote])
  const worker = await mountWorker(main, { host: h, commands: ['craftar.probe', 'craftar.open'] })
  const report = String(await worker.command('craftar.probe'))
  assert.match(report, /terminal: not opened/)
  assert.equal(h.callsOf('terminal.create').length, 0)
  await worker.deactivate()
})

test('a craftar that cannot be found is reported and nothing is started', async () => {
  const h = host({ craftarPath: 'not/absolute' })
  const worker = await mountWorker(main, { host: h, commands: ['craftar.probe', 'craftar.open'] })
  const report = String(await worker.command('craftar.probe'))
  assert.match(report, /craftar: not found \(craftarPath must be an absolute path/)
  assert.doesNotMatch(report, /version:/)
  await worker.deactivate()
})

// The probe made visible (2026-11-07, measured in Orca 1.4.250: a palette command's return value is shown
// nowhere and a status bar item without `command` does nothing on a click).

test('the status bar item shows or hides the side bar that holds the panel; the probe stays in the palette', async () => {
  const manifest = JSON.parse(readFileSync(fileURLToPath(new URL('../orca-plugin.json', import.meta.url)), 'utf8'))
  const item = manifest.contributes.statusBarItems.find((i: { id: string }) => i.id === 'craftar')
  assert.equal(item.command, 'craftar.open')
  assert.ok(manifest.contributes.commands.some((c: { id: string }) => c.id === 'craftar.open'))
  assert.ok(manifest.contributes.commands.some((c: { id: string }) => c.id === 'craftar.probe'))
  const h = host({ craftarPath: stubCraftar() })
  const worker = await mountWorker(main, { host: h, commands: ['craftar.probe', 'craftar.open'] })
  await worker.command('craftar.open')
  // Orca 1.4.250 gives a plugin no way to open its own panel: the nearest is toggling the right side bar.
  assert.deepEqual(h.callsOf('commands.run'), [{ action: 'sidebar.right.toggle' }])
  assert.equal(h.callsOf('terminal.create').length, 0)
  await worker.deactivate()
})

test('the probe report reaches the panel, terminal lines included', async () => {
  const marker = 'acme-user@acme-host:/tmp/acme-portal$'
  const h = host({ craftarPath: stubCraftar() }, [ACME], [marker + ' echo craftar-probe', 'craftar-probe'])
  const worker = await mountWorker(main, { host: h, commands: ['craftar.probe', 'craftar.open'] })
  const report = String(await worker.command('craftar.probe'))
  const posted = worker.posts.filter((p) => p.event === 'state.changed').map((p) => p.payload as { probe?: { lines: string[] } | null })
  const last = posted[posted.length - 1]
  assert.ok(last?.probe, 'a state.changed with the probe report')
  assert.deepEqual(last.probe.lines, report.split('\n'))
  assert.ok(last.probe.lines.some((l) => l.includes(marker)))
  await worker.deactivate()
})

test('the probe shows one notification with the outcome and no terminal line', async () => {
  const marker = 'acme-user@acme-host:/tmp/acme-portal$'
  const h = host({ craftarPath: stubCraftar() }, [ACME], [marker + ' echo craftar-probe', 'craftar-probe'])
  const worker = await mountWorker(main, { host: h, commands: ['craftar.probe', 'craftar.open'] })
  await worker.command('craftar.probe')
  const shown = h.callsOf('notifications.show') as { title: string; body?: string }[]
  assert.equal(shown.length, 1)
  assert.equal(shown[0].title, 'craftar probe')
  assert.match(String(shown[0].body), /craftar found/)
  assert.match(String(shown[0].body), /terminal: craftar-probe seen/)
  assert.match(String(shown[0].body), /craftar panel/)
  assert.equal(String(shown[0].body).includes(marker), false)
  assert.equal(String(shown[0].body).includes('/tmp/'), false)
  assert.equal(String(shown[0].body).includes('t1'), false)
  await worker.deactivate()
})

test('the log carries the terminal outcome and the terminal id, never its lines or craftar path', async () => {
  const marker = 'acme-user@acme-host:/tmp/acme-portal$'
  const stub = stubCraftar()
  const h = host({ craftarPath: stub }, [ACME], [marker + ' echo craftar-probe', 'craftar-probe'])
  const worker = await mountWorker(main, { host: h, commands: ['craftar.probe', 'craftar.open'] })
  await worker.command('craftar.probe')
  const log = worker.logs.join('\n')
  assert.match(log, /terminal: craftar-probe seen \(terminal t1\)/)
  assert.match(log, /craftar found/)
  assert.equal(log.includes(marker), false)
  assert.equal(log.includes(stub), false)
  await worker.deactivate()
})

test('a terminal.create that fails is logged with its code', async () => {
  const h = mockHost({
    capabilities: CAPS,
    settings: { craftarPath: stubCraftar() },
    results: {
      'workspace.list': { workspaces: [ACME], truncated: false },
      'workspace.readContext': { branch: 'main', displayName: 'acme-portal', terminals: [] },
    },
    // No result configured for terminal.create: the mock host answers it with the error code `unavailable`.
  })
  const worker = await mountWorker(main, { host: h, commands: ['craftar.probe', 'craftar.open'] })
  await worker.command('craftar.probe')
  assert.match(worker.logs.join('\n'), /terminal: failed \(unavailable\)/)
  await worker.deactivate()
})

test('the Orca CLI is looked for as orca-ide; an `orca` on PATH is not taken for it', async () => {
  const dir = tempDir('craftar-orca-path-')
  const orca = join(dir, process.platform === 'win32' ? 'orca.exe' : 'orca')
  copyFileSync(process.execPath, orca)
  if (process.platform !== 'win32') chmodSync(orca, 0o755)
  const before = process.env.PATH
  process.env.PATH = dir
  try {
    const h = host({ craftarPath: stubCraftar() })
    const worker = await mountWorker(main, { host: h, commands: ['craftar.probe', 'craftar.open'] })
    const report = String(await worker.command('craftar.probe'))
    assert.match(report, /Orca CLI \(orca-ide\): not on an absolute PATH entry/)
    assert.match(report, /an `orca` on PATH is another program/)
    await worker.deactivate()
  } finally {
    process.env.PATH = before
  }
})

test('a second click while the probe runs opens no second terminal', async () => {
  const h = host({ craftarPath: stubCraftar() })
  const worker = await mountWorker(main, { host: h, commands: ['craftar.probe', 'craftar.open'] })
  const [a, b] = await Promise.all([worker.command('craftar.probe'), worker.command('craftar.probe')])
  assert.equal(String(a), String(b))
  assert.equal(h.callsOf('terminal.create').length, 1)
  assert.equal(h.callsOf('notifications.show').length, 1)
  await worker.deactivate()
})

test('the status bar tooltip says what a click does', async () => {
  const h = host({ craftarPath: stubCraftar() })
  const worker = await mountWorker(main, { host: h, commands: ['craftar.probe', 'craftar.open'] })
  const updates = h.callsOf('statusBar.update') as { tooltip?: string }[]
  assert.ok(updates.length > 0 && updates.every((u) => String(u.tooltip).endsWith(' · click: show or hide the craftar panel')))
  await worker.deactivate()
})

test('the probe opens its terminal in a workspace whose hostId is "local"', async () => {
  const h = host({ craftarPath: stubCraftar() }, [{ ...ACME, hostId: 'local' }])
  const worker = await mountWorker(main, { host: h, commands: ['craftar.probe', 'craftar.open'] })
  const report = String(await worker.command('craftar.probe'))
  assert.match(report, /terminal: craftar-probe seen/)
  assert.deepEqual((h.callsOf('terminal.create')[0] as { workspaceId: string }).workspaceId, 'w1')
  await worker.deactivate()
})

// The user's ruling (2026-11-07): the icon is drawn from the logo's three squares (A2) — the manifest's
// `icon` (PNG, square, at least 128 px: Orca 1.4.250 refuses SVG) — and the panel tab and the status bar
// item, which take only Orca's named icons, use `package` (ruled 2026-11-07, after `blocks` read as a broken logo).
test('the plugin icon is a square PNG of at least 128 px, and the panel and the status bar use `package`', async () => {
  const manifest = JSON.parse(readFileSync(fileURLToPath(new URL('../orca-plugin.json', import.meta.url)), 'utf8'))
  assert.equal(manifest.icon, 'assets/icon.png')
  const png = readFileSync(fileURLToPath(new URL('../assets/icon.png', import.meta.url)))
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const w = png.readUInt32BE(16)
  const hgt = png.readUInt32BE(20)
  assert.equal(w, hgt)
  assert.ok(w >= 128)
  assert.ok(png.length <= 256 * 1024)
  assert.ok(manifest.contributes.panels.every((p: { icon: string }) => p.icon === 'package'))
  assert.ok(manifest.contributes.statusBarItems.every((i: { icon: string }) => i.icon === 'package'))
  const h = host({ craftarPath: stubCraftar() })
  const worker = await mountWorker(main, { host: h, commands: ['craftar.probe', 'craftar.open'] })
  await worker.command('craftar.probe')
  const updates = h.callsOf('statusBar.update') as { icon?: string }[]
  assert.ok(updates.length > 0 && updates.every((u) => u.icon === 'package'))
  await worker.deactivate()
})
