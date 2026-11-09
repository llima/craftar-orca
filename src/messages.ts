// What the bell lists (the user's request of 2026-11-08): each of craftar's messages kept in its own words, with a level
// and, where the plugin knows one, a suggested fix shown as a separate line — never in place of craftar's text. The
// matching reads stable tokens of craftar's wording (craftar-cli src/core/capabilities.ts SKIP_WARNING, shared.ts
// flatSkillWarning, sync.ts's fetch lines), never a whole sentence: the floor is 0.33.0 and wording moved across versions.
// Pure: no I/O, no clock of its own.

export type Level = 'info' | 'action' | 'error'

export interface Message {
  text: string
  level: Level
  /** The plugin's suggestion, worded as one; absent when craftar's own line already says what to do. */
  fix?: string
  /** Who said it: craftar's words, or the plugin's own line (the cached copy's age). */
  from: 'craftar' | 'plugin'
}

// craftar's target names as they appear in a skip line (SKIP_WARNING's keys).
const TARGET_LABEL: Record<string, string> = {
  'claude-code': 'Claude Code', kiro: 'Kiro', 'agents-md': 'AGENTS.md', cursor: 'Cursor', copilot: 'Copilot',
  'agent-skills': 'Agent Skills', codex: 'Codex', antigravity: 'Antigravity', opencode: 'OpenCode',
}

// `<target>: <n> <type> ingredient(s) have no <label> equivalent — skipped: <refs>` (per type) and
// `<target>: <type> <ref> has no <label> equivalent — skipped` (per ingredient).
const SKIP_TYPE = /^([a-z][a-z-]*): \d+ ([a-z]+) ingredient\(s\) have no .+ equivalent — skipped/
const SKIP_ONE = /^([a-z][a-z-]*): ([a-z]+) \S+ has no .+ equivalent — skipped/

/**
 * One message as the bell shows it. `owners` are the targets this workspace writes (the panel's surfaces): a skip's fix
 * names them as what the workspace also writes for, never as writing the skipped ingredient.
 */
export function classify(text: string, err: boolean, owners: string[]): Message {
  if (err) return { text, level: 'error', from: 'craftar' }
  const skip = SKIP_TYPE.exec(text) ?? SKIP_ONE.exec(text)
  if (skip) {
    const [, target, type] = skip
    // Whether another target writes these ingredients depends on their own `targets`, which the panel does not read:
    // the line states only what the workspace writes for, and the skip stays one to look at.
    const others = owners.filter((o) => o !== target && o !== 'services')
    const label = TARGET_LABEL[target] ?? target
    const silence = `if they should not reach ${label}, give those ${type} ingredients targets that leave ${target} out, or take ${target} out of the targets (the profile's, or craftar.yaml's)`
    return {
      text, level: 'action', from: 'craftar',
      fix: `${label} gets no ${type} file${others.length > 0 ? `; this workspace also writes for ${others.join(', ')}` : ''}: ${silence}`,
    }
  }
  if (/^claude-code: Claude Code does not list a skill written as one file/.test(text)) return { text, level: 'action', from: 'craftar' }
  if (/ is generated, but git ignores it /.test(text)) return { text, level: 'action', from: 'craftar' }
  // `Forge <url> not fetched (--offline) — using the cached copy …` and `… not fetched (<git>) — using …`.
  if (/^Forge \S+ not fetched \(--offline\)/.test(text)) return { text, level: 'info', from: 'craftar' }
  if (/^Forge \S+ not fetched \(/.test(text)) return { text, level: 'action', from: 'craftar', fix: 'check the network or the Forge URL, then Try again on the fetch card, or wait for the next periodic check (Bring waits for a fetch that works)' }
  if (/\(last wins\)$/.test(text)) return { text, level: 'action', from: 'craftar', fix: 'keep one of the two ingredients in the profile, or give one of them targets that leave this file out' }
  return { text, level: 'action', from: 'craftar' }
}

/** The plugin's own information line for a cached copy: its age, so the person sees how old what they read is. */
export function cachedAgeLine(fetchedAt: number | null, now: number): Message {
  if (fetchedAt === null) return { text: 'showing the cached copy of the Forge, never fetched on this machine', level: 'info', from: 'plugin' }
  const min = Math.max(0, Math.round((now - fetchedAt) / 60_000))
  const age = min < 1 ? 'less than a minute' : min < 120 ? `${min} min` : `${Math.round(min / 60)} h`
  return { text: `showing the cached copy of the Forge, fetched ${age} ago`, level: 'info', from: 'plugin' }
}

/** What the badge counts: what asks for the person, never information. */
export function counted(list: Message[]): number {
  return list.filter((m) => m.level !== 'info').length
}
