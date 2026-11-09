// The CI and release workflows' contract (the CLI's test/ci.test.ts › release contract, in a smaller form): a release is made only
// by release.yml's approved run, on the commit ci tested, with no token but github.token. Read as text, line by line: the repository
// has no YAML parser, and each check names the line it needs, so a comment alone cannot satisfy one.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const read = (name: string) => readFileSync(join(ROOT, '.github', 'workflows', name), 'utf8').replace(/\r\n/g, '\n')
const code = (text: string) => text.split('\n').filter((l) => !l.trimStart().startsWith('#'))
const indent = (l: string) => l.length - l.trimStart().length

// The lines of one job, from `  <name>:` to the next job at the same indent.
function job(text: string, name: string): string[] {
  const lines = code(text)
  const start = lines.findIndex((l) => l === `  ${name}:`)
  assert.ok(start >= 0, `job ${name} not found`)
  const end = lines.findIndex((l, i) => i > start && /^  [a-z][\w-]*:$/.test(l))
  return lines.slice(start, end < 0 ? undefined : end)
}

// The text of every `run: |` block, which a ${{ }} expression must never reach (values come through env:).
function runBlocks(text: string): string[] {
  const lines = text.split('\n')
  const blocks: string[] = []
  lines.forEach((l, i) => {
    if (!/^\s+(- )?run: \|$/.test(l)) return
    const own = indent(l)
    const body: string[] = []
    for (let j = i + 1; j < lines.length && (lines[j].trim() === '' || indent(lines[j]) > own); j++) body.push(lines[j])
    blocks.push(body.join('\n'))
  })
  return blocks
}

const usesPinned = (text: string) => code(text).filter((l) => /^\s+- uses: /.test(l)).every((l) => /@[0-9a-f]{40} # v\d/.test(l))

test('ci.yml: read-only, never cancelled on main, actions pinned by SHA, the Orca pin in the form release.yml reads', () => {
  const ci = read('ci.yml')
  const lines = code(ci)
  assert.ok(lines.includes('permissions:') && lines.includes('  contents: read'))
  assert.ok(!lines.some((l) => /write-all|^\s+[a-z-]+: write$/.test(l)), 'ci.yml grants no write')
  assert.ok(lines.includes('  pull_request:') && !ci.includes('pull_request_target'))
  assert.ok(lines.includes("  cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}"))
  assert.ok(usesPinned(ci))
  assert.equal(lines.filter((l) => /^ {2}ORCA_VERSION: \d+\.\d+\.\d+$/.test(l)).length, 1)
  assert.equal(lines.filter((l) => /^ {2}ORCA_DEB_SHA256: [0-9a-f]{64}$/.test(l)).length, 1)
  assert.ok(runBlocks(ci).every((b) => !b.includes('${{')))
})

test('ci.yml: each Orca download is checked before it is opened; the type check installs no script', () => {
  const ci = read('ci.yml')
  assert.equal(code(ci).filter((l) => /^ {2}ORCA_WIN_SHA256: [0-9a-f]{64}$/.test(l)).length, 1)
  const before = (lines: string[], first: RegExp, then: RegExp) => {
    const a = lines.findIndex((l) => first.test(l))
    const b = lines.findIndex((l) => then.test(l))
    return a >= 0 && b > a
  }
  const linux = job(ci, 'plugin')
  assert.ok(before(linux, /echo "\$\{ORCA_DEB_SHA256\}  orca\.deb" \| sha256sum -c -$/, /dpkg-deb -x orca\.deb/))
  const windows = job(ci, 'windows')
  assert.ok(windows.includes('    runs-on: windows-latest'))
  assert.ok(before(windows, /echo "\$\{ORCA_WIN_SHA256\}  orca-setup\.exe" \| sha256sum -c -$/, /^\s+7z x /))
  const installs = code(ci).filter((l) => /\bnpm (ci|install|i)\b/.test(l))
  assert.ok(installs.length >= 1 && installs.every((l) => /^\s+npm ci --ignore-scripts\b/.test(l)), 'every install is npm ci --ignore-scripts')
  for (const gate of ['--version', 'plugin validate .', 'plugin check .', 'plugin test .']) {
    assert.ok(windows.includes(`      - run: orca ${gate}`), gate)
  }
})

test('release.yml: after ci on a push to main, no permission at the top, never cancelled', () => {
  const rel = read('release.yml')
  const lines = code(rel)
  for (const l of ['  workflow_run:', '    workflows: [ci]', '    types: [completed]', '    branches: [main]', 'permissions: {}', '  cancel-in-progress: false']) {
    assert.ok(lines.includes(l), l)
  }
  assert.ok(job(rel, 'check').includes("    if: github.event.workflow_run.conclusion == 'success' && github.event.workflow_run.event == 'push'"))
})

test('release.yml: check reads only; publish waits for the orca-release environment and writes contents only', () => {
  const rel = read('release.yml')
  const check = job(rel, 'check')
  const publish = job(rel, 'publish')
  assert.ok(check.includes('    permissions:') && check.includes('      contents: read'))
  assert.ok(!check.some((l) => /write/.test(l) && /^\s+[a-z-]+: write$/.test(l)))
  assert.ok(publish.includes('    environment: orca-release'))
  assert.ok(publish.includes('    needs: check') && publish.includes("    if: needs.check.outputs.publish == 'true'"))
  const perms = publish.slice(publish.indexOf('    permissions:') + 1).filter((l) => indent(l) === 6 && /^\s+[a-z-]+: (read|write)$/.test(l))
  assert.deepEqual(perms, ['      contents: write'])
})

test('release.yml: the tested commit is checked out and tagged; github.token is the only token; no expression in a script', () => {
  const rel = read('release.yml')
  const lines = code(rel)
  assert.ok(usesPinned(rel))
  const checkouts = lines.map((l, i) => (/^\s+- uses: actions\/checkout@/.test(l) ? i : -1)).filter((i) => i >= 0)
  assert.ok(checkouts.length >= 1)
  for (const i of checkouts) {
    const next = lines.slice(i + 1, i + 4)
    assert.ok(next.some((l) => l.trim() === 'ref: ${{ github.event.workflow_run.head_sha }}'), `checkout at line ${i + 1}`)
    assert.ok(next.some((l) => l.trim() === 'persist-credentials: false'), `checkout at line ${i + 1}`)
  }
  assert.ok(lines.includes('          HEAD_SHA: ${{ github.event.workflow_run.head_sha }}'))
  assert.ok(lines.some((l) => /gh release create "v\$VERSION" .*--target "\$HEAD_SHA"/.test(l)))
  // The guard refuses (exit 1 before its fi), and it comes before the release is created.
  const guard = lines.findIndex((l) => l.trim() === 'if [ "${GITHUB_SHA:-}" != "$HEAD_SHA" ]; then')
  const create = lines.findIndex((l) => /gh release create "v\$VERSION" /.test(l))
  assert.ok(guard >= 0 && create > guard, 'the guard comes before gh release create')
  const end = lines.findIndex((l, i) => i > guard && l.trim() === 'fi')
  assert.ok(end > guard && end < create && lines.slice(guard + 1, end).some((l) => l.trim() === 'exit 1'), 'the guard exits 1')
  assert.ok(lines.includes('          GH_TOKEN: ${{ github.token }}'))
  assert.ok(!/secrets\.|id-token|NODE_AUTH_TOKEN|GITHUB_TOKEN/.test(rel))
  assert.ok(runBlocks(rel).every((b) => !b.includes('${{')))
})

test('release.yml: check refuses a release unless orca-release exists and requires a reviewer', () => {
  // A job naming an environment the repository lacks gets one created with no protection: on 2026-11-09 v0.2.1 was tagged that
  // way, with no approval. The check job, which publish needs, reads the environment first and refuses without a reviewer.
  const rel = read('release.yml')
  const check = job(rel, 'check')
  const start = check.indexOf('      - name: orca-release requires a reviewer')
  assert.ok(start >= 0, 'the check job has the reviewer step')
  const end = check.findIndex((l, i) => i > start && /^ {6}- /.test(l))
  const step = check.slice(start, end < 0 ? undefined : end)
  assert.ok(step.includes("        if: steps.tag.outputs.publish == 'true'"))
  assert.ok(step.includes('          GH_TOKEN: ${{ github.token }}'))
  // Exact lines, so the count (reviewers, not rules), the threshold (one or more) and the refusal of a failed read are pinned.
  for (const line of [
    'set -euo pipefail',
    "query='[.protection_rules[]? | select(.type == \"required_reviewers\") | .reviewers[]?] | length'",
    'if ! reviewers=$(gh api "repos/$GITHUB_REPOSITORY/environments/orca-release" --jq "$query"); then',
    'if ! [ "$reviewers" -ge 1 ] 2>/dev/null; then',
  ]) assert.ok(step.some((l) => l.trim() === line), line)
  assert.equal(step.filter((l) => l.trim() === 'exit 1').length, 2, 'a failed read and no reviewer both refuse')
  const perms = check.slice(check.indexOf('    permissions:') + 1).filter((l) => indent(l) === 6 && /^\s+[a-z-]+: (read|write)$/.test(l))
  assert.deepEqual(perms, ['      contents: read', '      actions: read'])
})
