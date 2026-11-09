// One craftar run at a time per workspace, and which reads may fetch (spec 60 §7.1).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { afterEach } from 'orca/testing'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { removeTempDirs } from '../test-support/tmp'
import { fixture, stubCraftar } from '../test-support/stub-craftar'
import { intervalMs, readStatus, Serial } from './scheduler'

afterEach(removeTempDirs)

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => {}
  const promise = new Promise<void>((r) => (resolve = r))
  return { promise, resolve }
}

test('two runs on one workspace never overlap: the second waits for the first', async () => {
  const q = new Serial()
  const log: string[] = []
  const gate = deferred()
  const first = q.run('/home/acme/web', async () => {
    log.push('first start')
    await gate.promise
    log.push('first end')
  })
  const second = q.run('/home/acme/web', async () => {
    log.push('second start')
  })
  await new Promise((r) => setTimeout(r, 20))
  assert.deepEqual(log, ['first start'])
  gate.resolve()
  await Promise.all([first, second])
  assert.deepEqual(log, ['first start', 'first end', 'second start'])
})

test('runs on two workspaces do not wait for each other, and a failed run does not block the next', async () => {
  const q = new Serial()
  const gate = deferred()
  const slow = q.run('/home/acme/web', () => gate.promise)
  let other = false
  await q.run('/home/acme/ws', async () => {
    other = true
  })
  assert.equal(other, true)
  gate.resolve()
  await slow
  await assert.rejects(q.run('/home/acme/web', async () => Promise.reject(new Error('boom'))), /boom/)
  assert.equal(await q.run('/home/acme/web', async () => 'next'), 'next')
})

test('the interval honours the minimum of 2 minutes and falls back to 2 on a value that is not a number', () => {
  assert.equal(intervalMs(15), 15 * 60_000)
  assert.equal(intervalMs(1), 2 * 60_000)
  assert.equal(intervalMs(7.9), 7 * 60_000)
  assert.equal(intervalMs('often'), 2 * 60_000)
  assert.equal(intervalMs(Number.NaN), 2 * 60_000)
  assert.equal(intervalMs(undefined), 2 * 60_000)
})

test("the manifest default of the interval is 2 minutes, as the worker falls back to (the user's ruling, 2026-11-08)", () => {
  const manifest = JSON.parse(readFileSync(fileURLToPath(new URL('../orca-plugin.json', import.meta.url)), 'utf8'))
  const setting = manifest.contributes.settings.find((x: { key: string }) => x.key === 'intervalMinutes')
  assert.equal(setting.default, 2)
  assert.equal(setting.minimum, 2)
})

test('only the periodic read fetches, and only with the fetch setting on; a focus change never fetches', async () => {
  const WS = '/home/acme/web'
  const s = stubCraftar({ 'status --json': { stdout: fixture('status.json'), code: 0 } })
  await readStatus(s, WS, 'periodic', { fetch: true })
  await readStatus(s, WS, 'periodic', { fetch: false })
  await readStatus(s, WS, 'focus', { fetch: true })
  assert.deepEqual(
    s.calls().map((c) => c.argv.includes('--offline')),
    [false, true, true],
  )
})
