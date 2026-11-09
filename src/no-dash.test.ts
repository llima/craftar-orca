// The user's ruling of 2026-11-08: no dash (— or a – used as one) in any text the plugin shows. craftar's own words are
// relayed as craftar wrote them, so only the patterns that match craftar's wording may hold one.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
// Lines that quote craftar's own wording to recognise it (src/messages.ts), never shown by the plugin.
const CRAFTAR_WORDS = [/equivalent — skipped\//]

test("the plugin's own texts hold no dash: the sources outside comments, the manifest and the README", () => {
  const offenders: string[] = []
  for (const f of readdirSync(join(ROOT, 'src')).filter((n) => n.endsWith('.ts') && !n.endsWith('.test.ts'))) {
    readFileSync(join(ROOT, 'src', f), 'utf8').split('\n').forEach((line, i) => {
      const code = line.trimStart()
      if (code.startsWith('//') || code.startsWith('*') || code.startsWith('/*')) return
      if (/[—–]/.test(line.replace(/\/\/ .*$/, '')) && !CRAFTAR_WORDS.some((r) => r.test(line))) offenders.push(`src/${f}:${i + 1}`)
    })
  }
  for (const f of ['orca-plugin.json', 'README.md']) {
    readFileSync(join(ROOT, f), 'utf8').split('\n').forEach((line, i) => {
      if (/[—–]/.test(line)) offenders.push(`${f}:${i + 1}`)
    })
  }
  assert.deepEqual(offenders, [])
})
