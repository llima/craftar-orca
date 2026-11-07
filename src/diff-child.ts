// A file's diff (spec 60 §4, §6): craftar has no `diff --json`, so the diff comes from the `diff` tool of
// a long-lived `craftar mcp --workspace <abs dir>` child, started on the first diff — never with --fetch
// (it reads the cached copy) and never with --allow-writes. JSON-RPC over newline-delimited stdio. The
// child is pinned to the forge, ref and profile it started with: on PIN_CHANGED it is restarted once and
// the call retried. Any other tool error is craftar's refusal, relayed in its words. stderr is not read.
import { isAbsolute } from 'node:path'
import type { Craftar, FileState } from './craftar'
import { McpSession, type ToolResult, toolDocument, toolText } from './mcp-client'

const CALL_TIMEOUT_MS = 30_000
// The start of craftar's PIN_CHANGED text (craftar-cli src/core/mcp-protocol.ts); it names keys, never values.
const PIN_CHANGED_START = 'the Forge or the profile of this workspace changed since craftar mcp started'

export interface DiffResult {
  files: { path: string; state: FileState; added: number | null; removed: number | null; diff: string | null; note: string | null }[]
  warnings: string[]
  unsetParams: { key: string; declaredBy: string[]; citedBy: string[] }[]
}

export class DiffRefused extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DiffRefused'
  }
}

export class DiffChild {
  private session: Promise<McpSession> | null = null

  constructor(
    private readonly craftar: Craftar,
    private readonly ws: string,
  ) {
    if (!isAbsolute(ws)) throw new Error('craftar is given an absolute workspace directory only')
  }

  private start(): Promise<McpSession> {
    if (this.session) return this.session
    this.session = McpSession.open(this.craftar, ['mcp', '--workspace', this.ws], CALL_TIMEOUT_MS)
    this.session.catch(() => {
      this.session = null
    })
    return this.session
  }

  private async callDiff(path: string): Promise<ToolResult> {
    return (await this.start()).call('diff', { path })
  }

  async diff(path: string): Promise<DiffResult> {
    let r = await this.callDiff(path)
    if (r.isError && toolText(r).startsWith(PIN_CHANGED_START)) {
      await this.stop()
      r = await this.callDiff(path)
    }
    if (r.isError) throw new DiffRefused(toolText(r))
    return toolDocument<DiffResult>(r)
  }

  async stop(): Promise<void> {
    const s = this.session
    this.session = null
    if (!s) return
    try {
      await (await s).stop()
    } catch {
      // A child that failed to start has nothing to stop.
    }
  }
}
