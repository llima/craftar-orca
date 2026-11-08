// The one write of S2 (spec 60 §7 step 3, O2): the `sync` tool of a fresh `craftar mcp --workspace <abs dir>
// --allow-writes --fetch` child, stopped after its one call. The tool takes no argument and has no way to
// overwrite a hand edit: every drift, orphan-drift and collision is skipped and listed as kept. Never
// `craftar sync` directly, never --offline for a write. The consent stays craftar's: with none recorded, or
// one for other values, the tool refuses and nothing is written — the refusal is relayed in craftar's words.
import { CMD_REFUSED } from './run'
import { isAbsolute } from 'node:path'
import type { Craftar } from './craftar'
import { McpSession, toolDocument, toolText } from './mcp-client'

// The fetch of a remote Forge happens inside the call: longer than a read's limit.
const SYNC_TIMEOUT_MS = 180_000

// The fixed starts of craftar's tool errors (craftar-cli src/core/mcp-protocol.ts, the same in 0.61.1 and 1.3.1).
const WRITES_NOT_ALLOWED = 'writing is not allowed in this workspace'
const CONSENT_STALE = 'the write consent of this workspace was given for another'
const WRITES_NEED_REGISTRY = 'writing needs the registry'
const REGISTRY_UNREADABLE = 'the registry, where the consent is recorded, does not read'

/** The `sync` tool's result (craftar-cli syncToolResult). Paths, states and craftar's lines — no file content. */
export interface SyncResult {
  profile: string
  recipes: string[]
  targets: string[]
  forge: string
  written: string[]
  removed: { path: string; reason: string }[]
  skipped: { path: string; state: string; reason: string }[]
  warnings: string[]
  registry: string
}

export type SyncOutcome =
  | { kind: 'ok'; result: SyncResult }
  | { kind: 'consent'; reason: 'none' | 'stale'; text: string }
  | { kind: 'registry'; text: string }
  | { kind: 'error'; text: string }

function classify(text: string): SyncOutcome {
  if (text.startsWith(WRITES_NOT_ALLOWED)) return { kind: 'consent', reason: 'none', text }
  if (text.startsWith(CONSENT_STALE)) return { kind: 'consent', reason: 'stale', text }
  if (text.startsWith(WRITES_NEED_REGISTRY) || text.startsWith(REGISTRY_UNREADABLE)) return { kind: 'registry', text }
  return { kind: 'error', text }
}

export async function syncOnce(craftar: Craftar, ws: string): Promise<SyncOutcome> {
  if (!isAbsolute(ws)) throw new Error('craftar is given an absolute workspace directory only')
  let s: McpSession
  try {
    s = await McpSession.open(craftar, ['mcp', '--workspace', ws, '--allow-writes', '--fetch'], SYNC_TIMEOUT_MS)
  } catch (e) {
    return { kind: 'error', text: e instanceof Error && e.message === CMD_REFUSED ? CMD_REFUSED : 'craftar mcp did not start or did not answer' }
  }
  try {
    const r = await s.call('sync', {})
    if (r.isError) return classify(toolText(r))
    return { kind: 'ok', result: toolDocument<SyncResult>(r) }
  } catch {
    return { kind: 'error', text: 'craftar mcp did not answer the sync in time: it may still have written files; nothing was staged, so look at the files before updating again' }
  } finally {
    // A sync still writing when the answer is late is let finish, not killed mid-write: its input is closed
    // and the child exits once the call is done (killed only after ten minutes).
    await s.stop(600_000)
  }
}
