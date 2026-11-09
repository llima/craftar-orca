// The self-check shown at the top of the panel (spec 60 §5).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { afterEach } from 'orca/testing'
import { removeTempDirs } from '../test-support/tmp'
import { fixture, stubCraftar } from '../test-support/stub-craftar'
import { FLOOR, selfCheck, versionAtLeast } from './self-check'

afterEach(removeTempDirs)

const WS = '/home/acme/web'
const doctorAt = (version: string): string => JSON.stringify({ ...JSON.parse(fixture('doctor.json')), version })
const DOCTOR_ERROR = JSON.stringify({
  version: '1.0.0',
  workspace: WS,
  checks: [
    { id: 'node', scope: 'machine', level: 'ok', message: '22', fix: null },
    { id: 'mcp-env', scope: 'workspace', level: 'warn', message: 'ACME_TOKEN is not set', fix: 'set it' },
    { id: 'params', scope: 'workspace', level: 'error', message: 'acme.key is declared and has no value', fix: 'set it in the profile' },
  ],
})

// The stub craftar is a copy of node, which answers --version itself: the no-workspace tests answer it through the seam.
const answers = (stdout: string, code = 0) => async () => ({ code, stdout, stderr: '' })

function opts(bin: string, env: NodeJS.ProcessEnv, extra: Partial<Parameters<typeof selfCheck>[0]> = {}) {
  return { craftarPath: bin, craftarHome: '', path: '', baseEnv: env, ...extra }
}

test('the floor is the newest "since" among the surfaces S1 reads: repos --json, 0.33.0', () => {
  assert.equal(FLOOR, '0.33.0')
  assert.equal(versionAtLeast('0.33.0', FLOOR), true)
  assert.equal(versionAtLeast('1.0.0', FLOOR), true)
  assert.equal(versionAtLeast('0.32.9', FLOOR), false)
  assert.equal(versionAtLeast('0.4.10', '0.4.9'), true)
  assert.equal(versionAtLeast('not a version', FLOOR), false)
})

test('a craftar at the floor with a clean doctor and the registry on is all ok, and hands back the craftar to run', async () => {
  const s = stubCraftar({
    'doctor --json': { stdout: fixture('doctor.json'), code: 0 },
    'workspaces --json': { stdout: fixture('workspaces.json'), code: 0 },
  })
  const r = await selfCheck(opts(s.bin, s.env), WS)
  assert.deepEqual(r.lines.filter((l) => l.level !== 'ok'), [])
  assert.equal(r.craftar?.bin, s.bin)
  assert.deepEqual(
    s.calls().map((c) => c.argv),
    [['doctor', '--json', '--workspace', WS], ['workspaces', '--json']],
  )
})

test("a version below the floor (doctor's version field) is an error line and nothing else is run", async () => {
  const s = stubCraftar({ 'doctor --json': { stdout: doctorAt('0.32.9'), code: 0 } })
  const r = await selfCheck(opts(s.bin, s.env), WS)
  assert.equal(r.craftar, null)
  assert.match(r.lines.find((l) => l.level === 'error')?.message ?? '', /0\.32\.9 is older than 0\.33\.0/)
  assert.equal(s.calls().length, 1)
})

test("doctor's error lines are listed with their fix, its warnings are not, and no fix is applied", async () => {
  const s = stubCraftar({
    'doctor --json': { stdout: DOCTOR_ERROR, code: 1 },
    'workspaces --json': { stdout: fixture('workspaces.json'), code: 0 },
  })
  const r = await selfCheck(opts(s.bin, s.env), WS)
  const errors = r.lines.filter((l) => l.level === 'error').map((l) => l.message)
  assert.deepEqual(errors, ['doctor params: acme.key is declared and has no value (fix: set it in the profile)'])
  assert.equal(r.lines.some((l) => /ACME_TOKEN/.test(l.message)), false)
  assert.equal(s.calls().filter((c) => c.argv[0] === 'doctor').length, 1)
})

test('a doctor that prints no document is an error line, and nothing else is run', async () => {
  const s = stubCraftar({ 'doctor --json': { stdout: 'unknown command', code: 1 } })
  const r = await selfCheck(opts(s.bin, s.env), WS)
  assert.equal(r.craftar, null)
  assert.match(r.lines.find((l) => l.level === 'error')?.message ?? '', /no document \(exit 1\)/)
  assert.doesNotMatch(r.lines.map((l) => l.message).join('\n'), /unknown command/)
  assert.equal(s.calls().length, 1)
})

test('the registry off is said, since writes need it', async () => {
  const s = stubCraftar({
    'doctor --json': { stdout: fixture('doctor.json'), code: 0 },
  })
  const r = await selfCheck(opts(s.bin, { ...s.env, CRAFTAR_NO_REGISTRY: '1' }), WS)
  assert.match(r.lines.find((l) => l.level === 'warn')?.message ?? '', /registry is off \(CRAFTAR_NO_REGISTRY\)/)
  assert.equal(s.calls().some((c) => c.argv[0] === 'workspaces'), false)
})

test('a craftar that is not found is an error line naming why', async () => {
  const r = await selfCheck({ craftarPath: 'bin/craftar', craftarHome: '', path: '', baseEnv: process.env }, WS)
  assert.equal(r.craftar, null)
  assert.match(r.lines[0].message, /absolute/)
})

test('with no craftar workspace only craftar --version runs; asked about an unfocused one, its errors are not listed', async () => {
  const s = stubCraftar({
    'doctor --json': { stdout: DOCTOR_ERROR, code: 1 },
    'workspaces --json': { stdout: fixture('workspaces.json'), code: 0 },
  })
  const asked: string[] = []
  const none = await selfCheck(opts(s.bin, s.env, { version: async (bin) => (asked.push(bin), { code: 0, stdout: '1.9.0\n', stderr: '' }) }), null)
  assert.equal(none.craftar, null)
  assert.equal(none.version, '1.9.0')
  assert.deepEqual(asked, [s.bin])
  assert.equal(s.calls().length, 0)
  assert.deepEqual(none.lines.filter((l) => l.level !== 'ok'), [])
  assert.ok(none.lines.some((l) => l.message === 'version 1.9.0'))
  const other = await selfCheck(opts(s.bin, s.env), WS, { listErrors: false })
  assert.equal(other.lines.some((l) => l.level === 'error'), false)
  assert.deepEqual(s.calls()[0].argv, ['doctor', '--json', '--workspace', WS])
})

// P1 (the install test of 2026-11-09): a machine with Orca and no craftar learns it first, with or without a workspace.
test('with no craftar workspace, a craftar that is not found is an install line, not "nothing to read"', async () => {
  const r = await selfCheck({ craftarPath: '', craftarHome: '', path: '', baseEnv: process.env }, null)
  assert.equal(r.craftar, null)
  const bad = r.lines.filter((l) => l.level === 'error')
  assert.equal(bad.length, 1)
  assert.equal(bad[0].install, 'missing')
  assert.match(bad[0].message, /not found/)
  assert.equal(r.lines.some((l) => /nothing to read/.test(l.message)), false)
})

test('with no craftar workspace, a craftar whose --version fails is an install line naming the exit', async () => {
  const s = stubCraftar({})
  const r = await selfCheck(opts(s.bin, s.env, { version: answers('', 127) }), null)
  const bad = r.lines.filter((l) => l.level === 'error')
  assert.equal(bad.length, 1)
  assert.equal(bad[0].install, 'broken')
  assert.match(bad[0].message, /exit 127/)
})

test('with no craftar workspace, a craftar below the floor is an upgrade line', async () => {
  const s = stubCraftar({})
  const r = await selfCheck(opts(s.bin, s.env, { version: answers('0.32.9\n') }), null)
  const bad = r.lines.filter((l) => l.level === 'error')
  assert.equal(bad.length, 1)
  assert.equal(bad[0].install, 'old')
  assert.match(bad[0].message, /0\.32\.9 is older than 0\.33\.0/)
})

test('in a workspace, not found, no doctor document and below the floor are install lines; doctor errors are not', async () => {
  const notFound = await selfCheck({ craftarPath: '', craftarHome: '', path: '', baseEnv: process.env }, WS)
  assert.equal(notFound.lines[0].install, 'missing')
  const old = stubCraftar({ 'doctor --json': { stdout: doctorAt('0.32.9'), code: 0 } })
  assert.equal((await selfCheck(opts(old.bin, old.env), WS)).lines.find((l) => l.level === 'error')?.install, 'old')
  const broken = stubCraftar({ 'doctor --json': { stdout: 'unknown command', code: 1 } })
  assert.equal((await selfCheck(opts(broken.bin, broken.env), WS)).lines.find((l) => l.level === 'error')?.install, 'broken')
  const errs = stubCraftar({ 'doctor --json': { stdout: DOCTOR_ERROR, code: 1 }, 'workspaces --json': { stdout: fixture('workspaces.json'), code: 0 } })
  assert.equal((await selfCheck(opts(errs.bin, errs.env), WS)).lines.find((l) => l.level === 'error')?.install, undefined)
})

test('CRAFTAR_HOME from the setting reaches every child of the self-check', async () => {
  const s = stubCraftar({
    'doctor --json': { stdout: fixture('doctor.json'), code: 0 },
    'workspaces --json': { stdout: fixture('workspaces.json'), code: 0 },
  })
  const r = await selfCheck(opts(s.bin, s.env, { craftarHome: '/home/acme/home' }), WS)
  assert.deepEqual([...new Set(s.calls().map((c) => c.home))], ['/home/acme/home'])
  assert.equal(r.craftar?.env.CRAFTAR_HOME, '/home/acme/home')
})
