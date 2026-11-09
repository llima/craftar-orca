// The CI and release workflows' contract (the CLI's test/ci.test.ts › release contract, in a smaller form): a release is made only
// by release.yml's approved run, on the commit ci tested, with no token but github.token. Read as text, line by line: the repository
// has no YAML parser, and each check names the line it needs, so a comment alone cannot satisfy one.
import { assert, test } from 'orca/testing'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
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
  assert.ok(lines.includes("  cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}"))
  assert.ok(usesPinned(ci))
  assert.equal(lines.filter((l) => /^ {2}ORCA_VERSION: \d+\.\d+\.\d+$/.test(l)).length, 1)
  assert.equal(lines.filter((l) => /^ {2}ORCA_DEB_SHA256: [0-9a-f]{64}$/.test(l)).length, 1)
  assert.ok(runBlocks(ci).every((b) => !b.includes('${{')))
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
  assert.ok(lines.some((l) => l.trim() === 'if [ "${GITHUB_SHA:-}" != "$HEAD_SHA" ]; then'))
  assert.ok(lines.includes('          GH_TOKEN: ${{ github.token }}'))
  assert.ok(!/secrets\.|id-token|NODE_AUTH_TOKEN|GITHUB_TOKEN/.test(rel))
  assert.ok(runBlocks(rel).every((b) => !b.includes('${{')))
})
