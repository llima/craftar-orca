// findCraftar: which `craftar` the worker starts (spec 60 O1).
import { afterEach, assert, test } from 'orca/testing'
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { removeTempDirs, tempDir } from '../test-support/tmp'
import { findCraftar } from './resolve'

afterEach(removeTempDirs)

const posix = process.platform !== 'win32'

function binDir(...parts: string[]): string {
  const dir = join(tempDir(), ...parts)
  mkdirSync(dir, { recursive: true })
  return dir
}

function plant(dir: string): string {
  const file = join(dir, posix ? 'craftar' : 'craftar.exe')
  writeFileSync(file, '')
  if (posix) chmodSync(file, 0o755)
  return file
}

test('a craftarPath setting that is absolute and exists is used as given', () => {
  const file = plant(binDir('a'))
  assert.deepEqual(findCraftar({ craftarPath: file, path: '' }), { found: file, shim: null })
})

test('a relative craftarPath is refused, never looked up', () => {
  const r = findCraftar({ craftarPath: 'bin/craftar', path: '' })
  assert.equal(r.found, null)
  assert.match(r.reason ?? '', /absolute/)
})

test('an empty craftarPath looks in the absolute PATH entries only', () => {
  const rel = 'relative-bin'
  const abs = binDir('b')
  const file = plant(abs)
  const sep = posix ? ':' : ';'
  assert.deepEqual(findCraftar({ craftarPath: '', path: [rel, '', abs].join(sep) }), { found: file, shim: null })
})

test('nothing on PATH is said, with no npx fallback', () => {
  const r = findCraftar({ craftarPath: '', path: binDir('empty') })
  assert.equal(r.found, null)
  assert.match(r.reason ?? '', /not found/)
  assert.doesNotMatch(r.reason ?? '', /npx/)
})

test('a binary under a version manager shim directory is found and named as such', () => {
  const file = plant(binDir('.asdf', 'shims'))
  const r = findCraftar({ craftarPath: file, path: '' })
  assert.equal(r.found, file)
  assert.equal(r.shim, 'asdf')
})

test('on Windows a .cmd shim named by craftarPath is refused in words, not started', () => {
  const r = findCraftar({ craftarPath: '/opt/npm/craftar.cmd', path: '', platform: 'win32' })
  assert.equal(r.found, null)
  assert.match(r.reason ?? '', /\.cmd or \.bat/)
})
