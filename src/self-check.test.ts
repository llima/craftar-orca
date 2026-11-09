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

test('with no craftar workspace nothing is started; asked about an unfocused one, its errors are not listed', async () => {
  const s = stubCraftar({
    'doctor --json': { stdout: DOCTOR_ERROR, code: 1 },
    'workspaces --json': { stdout: fixture('workspaces.json'), code: 0 },
  })
  const none = await selfCheck(opts(s.bin, s.env), null)
  assert.equal(none.craftar, null)
  assert.equal(s.calls().length, 0)
  const other = await selfCheck(opts(s.bin, s.env), WS, { listErrors: false })
  assert.equal(other.lines.some((l) => l.level === 'error'), false)
  assert.deepEqual(s.calls()[0].argv, ['doctor', '--json', '--workspace', WS])
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
