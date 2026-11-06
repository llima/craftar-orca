// run(): an argument array, never a shell; childEnv(): CRAFTAR_HOME from the setting (spec 60 §10, O1).
import { assert, test } from 'orca/testing'
import { childEnv, run } from './run'

test('an argument holding shell syntax reaches the child as one literal argument', async () => {
  const hostile = 'a; echo injected && $(whoami) `id` | cat'
  const r = await run(process.execPath, ['-e', 'process.stdout.write(process.argv[1])', hostile], process.env)
  assert.equal(r.code, 0)
  assert.equal(r.stdout, hostile)
})

test('CRAFTAR_HOME reaches the child when the setting is set, and the worker env is kept otherwise', async () => {
  const env = childEnv({ PATH: process.env.PATH, CRAFTAR_HOME: '/from/worker' }, '/tmp/acme-home')
  const r = await run(process.execPath, ['-e', 'process.stdout.write(process.env.CRAFTAR_HOME ?? "")'], env)
  assert.equal(r.stdout, '/tmp/acme-home')
  assert.equal(childEnv({ CRAFTAR_HOME: '/from/worker' }, '  ').CRAFTAR_HOME, '/from/worker')
})

test('a child that exits non-zero reports its code', async () => {
  const r = await run(process.execPath, ['-e', 'process.exit(3)'], process.env)
  assert.equal(r.code, 3)
})
