// The read surface over craftar's --json contracts (spec 60 §3, §7.1): which argv each read passes, and
// what counts as a document. Every call goes to a stub craftar.
import { afterEach, assert, test } from 'orca/testing'
import { removeTempDirs } from '../test-support/tmp'
import { fixture, stubCraftar } from '../test-support/stub-craftar'
import { doctor, driftShow, ReadFailure, repos, status, workspaces } from './craftar'

afterEach(removeTempDirs)

const WS = '/home/acme/web'

test('the periodic status read fetches; with fetch off it passes --offline', async () => {
  const s = stubCraftar({ 'status --json': { stdout: fixture('status.json'), code: 0 } })
  const a = await status(s, WS, { fetch: true })
  await status(s, WS, { fetch: false })
  const [one, two] = s.calls()
  assert.deepEqual(one.argv, ['status', '--json', '--workspace', WS])
  assert.deepEqual(two.argv, ['status', '--json', '--offline', '--workspace', WS])
  assert.equal(a.forge.commit, 'd2309dc201c9a5127285a83092fb3853b8926101')
  assert.deepEqual(
    a.statuses.filter((f) => f.state !== 'unchanged').map((f) => [f.path, f.state]),
    [
      ['.claude/rules/commit-conventions.md', 'drift'],
      ['.claude/rules/workflow.md', 'update'],
    ],
  )
})

test('drift show, repos and doctor read offline; workspaces takes no --workspace and no --fetch', async () => {
  const s = stubCraftar({
    'drift show --json': { stdout: fixture('drift-show.json'), code: 1 },
    'repos --json': { stdout: fixture('repos.json'), code: 0 },
    'doctor --json': { stdout: fixture('doctor.json'), code: 0 },
    'workspaces --json': { stdout: fixture('workspaces.json'), code: 0 },
  })
  const d = await driftShow(s, WS)
  await repos(s, WS)
  await doctor(s, WS)
  const w = await workspaces(s)
  assert.deepEqual(
    s.calls().map((c) => c.argv),
    [
      ['drift', 'show', '--json', '--offline', '--workspace', WS],
      ['repos', '--json', '--offline', '--workspace', WS],
      ['doctor', '--json', '--workspace', WS],
      ['workspaces', '--json'],
    ],
  )
  assert.equal(d.files[0].promotable, true)
  assert.deepEqual(
    w.workspaces.map((x) => [x.path, x.status, x.forgeMoved]),
    [
      ['/home/acme/web', 'drift', true],
      ['/home/acme/ws', 'up-to-date', false],
    ],
  )
})

test('a document printed with exit 1 is read, not a failure (a refused sync)', async () => {
  const doc = { forge: {}, statuses: [], warnings: ['refused'], unsetParams: [{ key: 'k', declaredBy: [], citedBy: [] }] }
  const s = stubCraftar({ 'status --json': { stdout: JSON.stringify(doc), code: 1 } })
  const r = await status(s, WS, { fetch: false })
  assert.equal(r.unsetParams.length, 1)
  assert.deepEqual(r.warnings, ['refused'])
})

test('no document is a ReadFailure naming the exit code, carrying nothing of stdout or stderr', async () => {
  const s = stubCraftar({
    'drift show --json': { stdout: 'acme-secret-stdout', code: 1, stderr: 'error: /home/acme/private-path\n' },
    'repos --json': { stdout: '', code: 3 },
  })
  for (const read of [() => driftShow(s, WS), () => repos(s, WS)]) {
    await assert.rejects(read(), (e: unknown) => {
      assert.ok(e instanceof ReadFailure)
      assert.match((e as Error).message, /exit [13]/)
      assert.doesNotMatch((e as Error).message, /acme-secret-stdout|private-path/)
      return true
    })
  }
})

test('a workspace path that is not absolute is refused before craftar starts', async () => {
  const s = stubCraftar({})
  await assert.rejects(status(s, 'web', { fetch: false }), /absolute/)
  assert.equal(s.calls().length, 0)
})

test('CRAFTAR_HOME in the environment it is handed reaches the child', async () => {
  const s = stubCraftar({ 'workspaces --json': { stdout: fixture('workspaces.json'), code: 0 } })
  await workspaces({ bin: s.bin, env: { ...s.env, CRAFTAR_HOME: '/home/acme/home' } })
  assert.equal(s.calls()[0].home, '/home/acme/home')
})

test("status keeps craftar's exit code beside the document, since exit 1 is how a failed check is said", async () => {
  const s = stubCraftar({ 'status --json': { stdout: fixture('status.json'), code: 1 } })
  assert.equal((await status(s, WS, { fetch: false })).exitCode, 1)
  const ok = stubCraftar({ 'status --json': { stdout: fixture('status.json'), code: 0 } })
  assert.equal((await status(ok, WS, { fetch: false })).exitCode, 0)
})
