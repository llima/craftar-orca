// What the panel and the status bar show, built from craftar's documents (spec 60 §4, §6).
import { assert, test } from 'orca/testing'
import { fixture } from '../test-support/stub-craftar'
import type { DriftDoc, ReposDoc, StatusDoc, WorkspacesDoc } from './craftar'
import { barFor, buildModel } from './model'

const WS = '/home/acme/web'
const status = (): StatusDoc => JSON.parse(fixture('status.json'))
const drift = (): DriftDoc => JSON.parse(fixture('drift-show.json'))
const repos = (): ReposDoc => JSON.parse(fixture('repos.json'))
const registry = (): WorkspacesDoc => JSON.parse(fixture('workspaces.json'))

function model(over: Partial<Parameters<typeof buildModel>[0]> = {}) {
  return buildModel({ ws: WS, name: 'web', status: status(), drift: drift(), repos: repos(), registry: registry(), fetchedAt: null, readAt: 1, ...over })
}

test('the Forge box: source, ref, commit and the profile from drift show; a path Forge has no freshness label', () => {
  const m = model()
  assert.deepEqual(m.forge, {
    source: '../forge2',
    ref: null,
    commit: 'd2309dc201c9a5127285a83092fb3853b8926101',
    lockCommit: '4d764d62940512758ad50ef50362bbc72ef0a491',
    profile: 'acme-web',
    freshness: 'local',
    fetchedAt: null,
    pinned: null,
  })
})

test('a remote Forge reads "fetched" when this read fetched and "cached copy" otherwise, with the last fetch time', () => {
  const remote = (fetched: boolean): StatusDoc => ({ ...status(), forge: { ...status().forge, kind: 'git', fetched } })
  assert.equal(model({ status: remote(true) }).forge?.freshness, 'fetched')
  const cached = model({ status: remote(false), fetchedAt: 1234 })
  assert.equal(cached.forge?.freshness, 'cached')
  assert.equal(cached.forge?.fetchedAt, 1234)
  assert.equal(cached.forge?.pinned, null)
})

test('the flow: pending files go Forge → workspace, a drift goes back with promotable and reason verbatim', () => {
  const m = model()
  assert.deepEqual(m.pending, [{ path: '.claude/rules/workflow.md', state: 'update' }])
  assert.deepEqual(m.edited, [{ path: '.claude/rules/commit-conventions.md', state: 'drift', promotable: true, reason: null }])
  assert.deepEqual(m.apart, [])
  assert.deepEqual(m.outputs, [{ owner: 'claude-code', counts: { unchanged: 3, drift: 1, update: 1 } }])
})

test('collision and orphan-drift are shown apart; orphan is pending; a drift without a drift show row reads not promotable', () => {
  const s = status()
  s.statuses = [
    { path: 'AGENTS.md', state: 'collision', target: 'agents-md', ingredient: 'rule/a' },
    { path: '.kiro/steering/old.md', state: 'orphan-drift', target: 'kiro', ingredient: 'rule/old' },
    { path: '.kiro/steering/gone.md', state: 'orphan', target: 'kiro', ingredient: 'rule/gone' },
    { path: '.craftar/compose.yaml', state: 'drift', target: 'services', ingredient: 'service/db' },
  ]
  const d = drift()
  d.files = []
  const m = model({ status: s, drift: d })
  assert.deepEqual(m.apart.map((f) => f.state), ['collision', 'orphan-drift'])
  assert.deepEqual(m.pending.map((f) => f.state), ['orphan'])
  assert.deepEqual(m.edited, [{ path: '.craftar/compose.yaml', state: 'drift', promotable: false, reason: null }])
  assert.deepEqual(m.outputs.map((o) => o.owner), ['agents-md', 'kiro', 'services'])
})

test('linked projects: the profile repositories and the other registered workspaces of the same Forge only', () => {
  const r = registry()
  r.workspaces.push({ ...r.workspaces[0], name: 'web-2', path: '/home/acme/web-2', status: 'outdated', forgeMoved: true })
  const m = model({ registry: r, repos: { ...repos(), repos: [{ name: 'api', url: 'https://example.com/acme/api.git', path: 'api', ref: null, state: 'missing', reason: null }] } })
  assert.deepEqual(m.siblings, [{ name: 'web-2', path: '/home/acme/web-2', status: 'outdated', forgeMoved: true }])
  assert.deepEqual(m.repos, [{ name: 'api', path: 'api', state: 'missing', reason: null }])
})

test("every warning craftar gave is kept, in craftar's words, without repeats; unset params mark the sync refused", () => {
  const s = { ...status(), warnings: ['w1', 'shared'], unsetParams: [{ key: 'acme.key', declaredBy: ['rule/a'], citedBy: ['rule/a'] }] }
  const m = model({ status: s, drift: { ...drift(), warnings: ['shared', 'w2'] }, repos: { ...repos(), warnings: ['w3'] } })
  assert.deepEqual(m.warnings, ['w1', 'shared', 'w2', 'w3'])
  assert.equal(m.refused, true)
  assert.equal(model().refused, false)
})

test('a read that failed after status still shows status, with what failed said', () => {
  const m = model({ drift: null, repos: null, registry: null, errors: ['craftar drift show: no JSON document (exit 2)'] })
  assert.equal(m.forge?.profile, null)
  assert.deepEqual(m.errors, ['craftar drift show: no JSON document (exit 2)'])
  assert.deepEqual(m.edited, [{ path: '.claude/rules/commit-conventions.md', state: 'drift', promotable: false, reason: null }])
})

test('the status bar: in sync, Forge moved, edited, both, refused, error and nothing focused', () => {
  const synced = status()
  synced.statuses = synced.statuses.filter((f) => f.state === 'unchanged')
  const onlyPending = status()
  onlyPending.statuses = onlyPending.statuses.filter((f) => f.state !== 'drift')
  const d0 = { ...drift(), files: [] }
  assert.deepEqual(barFor(model({ status: synced, drift: d0 })), { text: 'craftar: in sync', tone: 'success' })
  assert.deepEqual(barFor(model({ status: onlyPending, drift: d0 })), { text: 'Forge moved · 1', tone: 'accent' })
  assert.deepEqual(barFor(model()), { text: 'Forge moved · 1 · edited · 1', tone: 'warning' })
  const onlyEdited = status()
  onlyEdited.statuses = onlyEdited.statuses.filter((f) => f.state !== 'update')
  assert.deepEqual(barFor(model({ status: onlyEdited })), { text: 'edited · 1', tone: 'warning' })
  assert.deepEqual(barFor(model({ status: { ...synced, unsetParams: [{ key: 'k', declaredBy: [], citedBy: [] }] } })), { text: 'craftar: sync refused', tone: 'danger' })
  assert.deepEqual(barFor('error'), { text: 'craftar: error', tone: 'danger' })
  assert.deepEqual(barFor(null), { text: 'craftar', tone: 'neutral' })
})

test('status exiting 1 with no unset parameter is a failed check, said as such, over any pending count', () => {
  const m = model({ status: { ...status(), exitCode: 1, warnings: ['a path leaves the workspace through a link'] } })
  assert.equal(m.refused, false)
  assert.equal(m.checkFailed, true)
  assert.deepEqual(barFor(m), { text: 'craftar: check failed', tone: 'danger' })
  assert.equal(model({ status: { ...status(), exitCode: 0 } }).checkFailed, false)
})

test("the registry's warnings join craftar's lines too", () => {
  const r = { ...registry(), warnings: ['registry: one entry is missing'] }
  assert.ok(model({ registry: r }).warnings.includes('registry: one entry is missing'))
})

// Measured in Orca 1.4.250 (2026-11-07): `craftar workspaces --json` says each registered workspace's plan
// warnings as `<its path>: <warning>`, so the focused workspace's panel listed every other one's.
test("the registry's warnings about another workspace are not this workspace's; its own and the registry's are kept", () => {
  const base = registry()
  const other = '/home/acme/other-client'
  const r = {
    ...base,
    workspaces: [...base.workspaces, { ...base.workspaces[0], path: other, name: 'other' }],
    warnings: [`${other}: agents-md: 2 agent ingredient(s) have no AGENTS.md equivalent — skipped`, `${WS}: a warning about this one`, 'registry: one entry is missing'],
  }
  const m = model({ registry: r })
  assert.equal(m.warnings.some((w) => w.includes(other)), false)
  assert.ok(m.warnings.includes(`${WS}: a warning about this one`))
  assert.ok(m.warnings.includes('registry: one entry is missing'))
})

test("this workspace's plan warning, said again by the registry with its path, is listed once", () => {
  const r = { ...registry(), warnings: [`${WS}: agents-md: the rule is long`] }
  const m = model({ status: { ...status(), warnings: ['agents-md: the rule is long'] }, registry: r })
  assert.deepEqual(m.warnings.filter((w) => w.includes('the rule is long')), ['agents-md: the rule is long'])
})

test('a remote Forge whose ref is a full commit id is pinned; a named ref is left for the worker to ask', () => {
  const at = (ref: string, kind = 'git'): StatusDoc => ({ ...status(), forge: { ...status().forge, kind, ref, fetched: true } })
  assert.equal(model({ status: at('d2309dc201c9a5127285a83092fb3853b8926101') }).forge?.pinned, 'commit')
  assert.equal(model({ status: at('D2309DC201C9A5127285A83092FB3853B8926101D2309DC201C9A5127285A830') }).forge?.pinned, 'commit')
  assert.equal(model({ status: at('v1.2.0') }).forge?.pinned, null)
  assert.equal(model({ status: at('d2309dc') }).forge?.pinned, null, 'a short id may be a branch name')
  assert.equal(model({ status: at('d2309dc201c9a5127285a83092fb3853b8926101', 'path') }).forge?.pinned, null, 'a path Forge is read as it is on disk')
})
