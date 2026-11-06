// Which workspaces are craftar's and which one has the focus (spec 60 O9).
import { afterEach, assert, test } from 'orca/testing'
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { removeTempDirs, tempDir } from '../test-support/tmp'
import { craftarWorkspaces, focused, type Row } from './focus'

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
