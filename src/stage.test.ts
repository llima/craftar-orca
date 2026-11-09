// Exact staging after a sync (spec 60 §7 step 4, §12a case 4): the written paths, the removed paths git
// tracks, and craftar.lock — less what git ignores — through `git add -- <paths>`; never -A, never a commit.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { afterEach } from 'orca/testing'
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { removeTempDirs, tempDir } from '../test-support/tmp'
import { findGit, stagePaths } from './stage'

afterEach(removeTempDirs)

const git = findGit(process.env.PATH ?? '')

function repo(): string {
  const dir = tempDir('craftar-orca-git-')
  const g = (...a: string[]) => execFileSync('git', ['-C', dir, ...a], { env: { ...process.env, GIT_AUTHOR_NAME: 'acme', GIT_AUTHOR_EMAIL: 'acme@example.com', GIT_COMMITTER_NAME: 'acme', GIT_COMMITTER_EMAIL: 'acme@example.com' } })
  g('init', '-q', '-b', 'main')
  mkdirSync(join(dir, '.claude/rules'), { recursive: true })
  writeFileSync(join(dir, '.claude/rules/old.md'), 'old\n')
  writeFileSync(join(dir, 'craftar.lock'), '{}\n')
  writeFileSync(join(dir, '.gitignore'), 'ignored/\n')
  writeFileSync(join(dir, 'unrelated.txt'), 'one\n')
  g('add', '-A')
  g('commit', '-q', '-m', 'init')
  return dir
}

function staged(dir: string): string[] {
  return execFileSync('git', ['-C', dir, 'diff', '--cached', '--name-only'], { encoding: 'utf8' }).split('\n').filter((l) => l !== '').sort()
}
function head(dir: string): string {
  return execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
}

test('written, tracked removed and craftar.lock are staged; nothing else is, and no commit is made', { skip: !git }, async () => {
  const dir = repo()
  const before = head(dir)
  writeFileSync(join(dir, '.claude/rules/new.md'), 'new\n')
  rmSync(join(dir, '.claude/rules/old.md'))
  writeFileSync(join(dir, 'craftar.lock'), '{"v":2}\n')
  writeFileSync(join(dir, 'unrelated.txt'), 'two\n')
  const r = await stagePaths(git!, dir, { written: ['.claude/rules/new.md'], removed: [{ path: '.claude/rules/old.md' }] })
  assert.deepEqual(r.staged, ['.claude/rules/new.md', '.claude/rules/old.md', 'craftar.lock'])
  assert.deepEqual(staged(dir), ['.claude/rules/new.md', '.claude/rules/old.md', 'craftar.lock'])
  assert.equal(head(dir), before)
})

test('an untracked removed path and an ignored written path are left out', { skip: !git }, async () => {
  const dir = repo()
  mkdirSync(join(dir, 'ignored'), { recursive: true })
  writeFileSync(join(dir, 'ignored/x.md'), 'x\n')
  const r = await stagePaths(git!, dir, { written: ['ignored/x.md'], removed: [{ path: '.claude/rules/never-tracked.md' }] })
  assert.deepEqual(r.staged, [])
  assert.deepEqual(r.leftOut.sort(), ['.claude/rules/never-tracked.md', 'ignored/x.md'])
  assert.deepEqual(staged(dir), [])
})

test('a path that starts with a dash is passed after --, never read as an option', { skip: !git }, async () => {
  const dir = repo()
  writeFileSync(join(dir, '-n.md'), 'dash\n')
  const r = await stagePaths(git!, dir, { written: ['-n.md'], removed: [] })
  assert.ok(r.staged.includes('-n.md'))
  assert.ok(staged(dir).includes('-n.md'))
})

test('a path with glob characters is a literal name: it never stages another file', { skip: !git }, async () => {
  const dir = repo()
  writeFileSync(join(dir, '[a].md'), 'forge\n')
  writeFileSync(join(dir, 'a.md'), 'mine\n')
  const r = await stagePaths(git!, dir, { written: ['[a].md'], removed: [] })
  assert.deepEqual(r.staged, ['[a].md'])
  assert.deepEqual(staged(dir), ['[a].md'])
})

test('a workspace in a subfolder of its repository reports staged paths relative to the workspace', { skip: !git }, async () => {
  const dir = repo()
  const sub = join(dir, 'sub')
  mkdirSync(join(sub, '.claude/rules'), { recursive: true })
  writeFileSync(join(sub, '.claude/rules/x.md'), 'x\n')
  const r = await stagePaths(git!, sub, { written: ['.claude/rules/x.md'], removed: [] })
  assert.deepEqual(r.staged, ['.claude/rules/x.md'])
})

test('an ignored, untracked craftar.lock is listed as left out', { skip: !git }, async () => {
  const dir = repo()
  writeFileSync(join(dir, '.gitignore'), 'ignored/\ncraftar.lock\n')
  execFileSync('git', ['-C', dir, 'rm', '-q', '--cached', 'craftar.lock'])
  const r = await stagePaths(git!, dir, { written: [], removed: [] })
  assert.ok(r.leftOut.includes('craftar.lock'))
})
