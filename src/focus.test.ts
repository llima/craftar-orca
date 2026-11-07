// Which workspaces are craftar's and which one has the focus (spec 60 O9).
import { afterEach, assert, test } from 'orca/testing'
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { removeTempDirs, tempDir } from '../test-support/tmp'
import { craftarWorkspaces, focused, focusedBy, type Row } from './focus'

afterEach(removeTempDirs)

function row(id: string, path: string, over: Partial<Row> = {}): Row {
  return { id, name: 'acme-web', path, branch: 'main', hostId: null, ...over }
}

function withYaml(): string {
  const dir = tempDir()
  writeFileSync(join(dir, 'craftar.yaml'), 'forge: ../forge\nprofile: acme-web\n')
  return dir
}

test('a local row holding a craftar.yaml file is a craftar workspace; one without, or with a directory of that name, is not', () => {
  const yes = withYaml()
  const no = tempDir()
  const dirNamed = tempDir()
  mkdirSync(join(dirNamed, 'craftar.yaml'))
  const r = craftarWorkspaces([row('a', yes), row('b', no), row('c', dirNamed), row('d', join(no, 'missing'))])
  assert.deepEqual(r.local.map((x) => x.id), ['a'])
  assert.deepEqual(r.remote, [])
})

test('a craftar.yaml that is a symbolic link is not followed and not counted', { skip: process.platform === 'win32' }, () => {
  const target = withYaml()
  const linked = tempDir()
  symlinkSync(join(target, 'craftar.yaml'), join(linked, 'craftar.yaml'))
  assert.deepEqual(craftarWorkspaces([row('a', linked)]).local, [])
})

test('a row on another host is listed and never read', () => {
  const r = craftarWorkspaces([row('r', '/home/acme/remote-only', { hostId: 'ssh-1' })])
  assert.deepEqual(r.local, [])
  assert.deepEqual(r.remote.map((x) => x.id), ['r'])
})

test('one row matching the context name and branch is focused; two ask the person; none is null', () => {
  const a = row('a', '/home/acme/web')
  const b = row('b', '/home/acme/web-2')
  const c = row('c', '/home/acme/api', { name: 'acme-api' })
  const ctx = { displayName: 'acme-web', branch: 'main' }
  assert.deepEqual(focused(ctx, [a, c], null), { kind: 'one', row: a })
  assert.deepEqual(focused(ctx, [a, b, c], null), { kind: 'ask', rows: [a, b] })
  assert.deepEqual(focused({ displayName: 'acme-web', branch: 'dev' }, [a, b], null), { kind: 'none' })
  assert.deepEqual(focused(null, [a], null), { kind: 'none' })
})

test('a stored answer wins over a tie only when it is one of the tied rows', () => {
  const a = row('a', '/home/acme/web')
  const b = row('b', '/home/acme/web-2')
  const ctx = { displayName: 'acme-web', branch: 'main' }
  assert.deepEqual(focused(ctx, [a, b], 'b'), { kind: 'one', row: b })
  assert.deepEqual(focused(ctx, [a, b], 'gone'), { kind: 'ask', rows: [a, b] })
})

// Measured in Orca 1.4.250 (Linux, 2026-11-07): workspace.list gives this machine's rows hostId "local"
// (`orca-ide host list`: `local  this machine`); null only on hosts that record no host.
test('a row whose hostId is "local" is on this machine: read when it holds craftar.yaml, never listed as another host', () => {
  const yes = withYaml()
  const no = tempDir()
  const r = craftarWorkspaces([row('a', yes, { hostId: 'local' }), row('b', no, { hostId: 'local' }), row('s', '/home/acme/x', { hostId: 'ssh-1' })])
  assert.deepEqual(r.local.map((x) => x.id), ['a'])
  assert.deepEqual(r.remote.map((x) => x.id), ['s'])
})

// Orca's CLI first (the user's ruling, 2026-11-07): the active workspace, then the context's terminals,
// then name and branch with the person's answer. A tier falls through only when it has no answer — never
// because its answer is not a craftar workspace.
const W = row('w', '/home/acme/web', { name: 'main' })
const A = row('a', '/home/acme/api', { name: 'main' })
const CTX = { displayName: 'main', branch: 'main', terminals: [{ id: 'term_1' }] }

test('the active workspace from Orca wins over a name-and-branch tie', () => {
  assert.deepEqual(focusedBy({ active: { kind: 'one', path: '/home/acme/api' }, terminalPaths: null }, CTX, [W, A], null), { kind: 'one', row: A })
})

test('an active workspace that is not a craftar one is no focus — the tie does not come back', () => {
  assert.deepEqual(focusedBy({ active: { kind: 'one', path: '/home/acme/docs' }, terminalPaths: ['/home/acme/web'] }, CTX, [W, A], 'w'), { kind: 'none' })
})

test("with no active workspace, the context's terminals decide when they all sit in one workspace", () => {
  assert.deepEqual(focusedBy({ active: { kind: 'none' }, terminalPaths: ['/home/acme/web'] }, CTX, [W, A], null), { kind: 'one', row: W })
  assert.deepEqual(focusedBy({ active: { kind: 'failed', reason: 'exit 1' }, terminalPaths: ['/home/acme/docs'] }, CTX, [W, A], null), { kind: 'none' })
})

test('with neither answer, name and branch decide, and a tie asks or takes the stored answer', () => {
  for (const terminalPaths of [null, [], ['/home/acme/web', '/home/acme/api']]) {
    assert.deepEqual(focusedBy({ active: { kind: 'failed', reason: 'not found' }, terminalPaths }, CTX, [W, A], null), { kind: 'ask', rows: [W, A] })
    assert.deepEqual(focusedBy({ active: { kind: 'none' }, terminalPaths }, CTX, [W, A], 'a'), { kind: 'one', row: A })
  }
})

test('an active row that disagrees with the context Orca just sent is taken as stale: the next tier decides', () => {
  const web = row('w', '/home/acme/web', { name: 'web', branch: 'main' })
  const api = row('a', '/home/acme/api', { name: 'api', branch: 'dev' })
  const ctx = { displayName: 'api', branch: 'dev', terminals: [] }
  assert.deepEqual(focusedBy({ active: { kind: 'one', path: '/home/acme/web' }, terminalPaths: [] }, ctx, [web, api], null), { kind: 'one', row: api })
  assert.deepEqual(focusedBy({ active: { kind: 'one', path: '/home/acme/api' }, terminalPaths: null }, ctx, [web, api], null), { kind: 'one', row: api })
})
