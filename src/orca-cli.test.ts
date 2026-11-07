// Orca's CLI as the source of the focus (the user's ruling, 2026-11-07): `orca-ide worktree ps --json`
// marks the workspace in focus `isActive` (measured in Orca 1.4.250: it follows every switch), and
// `orca-ide terminal list --json` maps a terminal to its workspace. Only paths are kept.
import { afterEach, assert, test } from 'orca/testing'
import { join } from 'node:path'
import { psDoc, stubOrcaCli, terminalsDoc } from '../test-support/stub-orca-cli'
import { removeTempDirs } from '../test-support/tmp'
import { activeWorkspacePath, findOrcaCli, terminalWorkspacePaths } from './orca-cli'

afterEach(removeTempDirs)
const posix = { skip: process.platform === 'win32' }

test('the active row of worktree ps is the focus, by its path; nothing else of the answer is kept', posix, async () => {
  const s = stubOrcaCli({ ps: psDoc([{ path: '/home/acme/web' }, { path: '/home/acme/api', active: true }]) })
  const cli = findOrcaCli(s.dir)
  assert.ok(cli)
  const r = await activeWorkspacePath(cli)
  assert.deepEqual(r, { kind: 'one', path: '/home/acme/api' })
  assert.deepEqual(s.calls(), ['worktree ps --json'])
})

test('no active row is none; a failing or unreadable answer is failed, with its exit code only', posix, async () => {
  const none = stubOrcaCli({ ps: psDoc([{ path: '/home/acme/web' }]) })
  assert.deepEqual(await activeWorkspacePath(findOrcaCli(none.dir)!), { kind: 'none' })
  const two = stubOrcaCli({ ps: psDoc([{ path: '/home/acme/web', active: true }, { path: '/home/acme/api', active: true }]) })
  assert.deepEqual(await activeWorkspacePath(findOrcaCli(two.dir)!), { kind: 'none' })
  const bad = stubOrcaCli({ ps: 'not json', psCode: 3 })
  assert.deepEqual(await activeWorkspacePath(findOrcaCli(bad.dir)!), { kind: 'failed', reason: 'exit 3' })
  const garbled = stubOrcaCli({ ps: { ok: true, result: { worktrees: 'x' } } })
  assert.deepEqual(await activeWorkspacePath(findOrcaCli(garbled.dir)!), { kind: 'failed', reason: 'no readable answer' })
})

test('orca-ide is looked for on the absolute PATH entries only', posix, () => {
  const s = stubOrcaCli()
  assert.equal(findOrcaCli(`relative${process.platform === 'win32' ? ';' : ':'}${s.dir}`)?.bin, join(s.dir, 'orca-ide'))
  assert.equal(findOrcaCli('relative/dir'), null)
  assert.equal(findOrcaCli(''), null)
})

test("the context's terminals map to the workspaces holding them", posix, async () => {
  const s = stubOrcaCli({ terminals: terminalsDoc([{ handle: 'term_a', path: '/home/acme/web' }, { handle: 'term_b', path: '/home/acme/api' }, { handle: 'term_c', path: '/home/acme/web' }]) })
  const cli = findOrcaCli(s.dir)!
  assert.deepEqual(await terminalWorkspacePaths(cli, ['term_a', 'term_c']), ['/home/acme/web'])
  assert.deepEqual(await terminalWorkspacePaths(cli, ['term_a', 'term_b']), ['/home/acme/api', '/home/acme/web'])
  assert.deepEqual(await terminalWorkspacePaths(cli, ['term_z']), [])
  assert.deepEqual(await terminalWorkspacePaths(cli, []), [])
  assert.deepEqual(s.calls(), ['terminal list --json', 'terminal list --json', 'terminal list --json'])
})
