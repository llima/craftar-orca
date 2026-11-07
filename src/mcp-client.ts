// A `craftar mcp` child over newline-delimited JSON-RPC on stdio (spec 60 §4, §7): spawned with an argument
// array, never a shell; initialize, then notifications/initialized; each request answered within its time
// limit or rejected. stderr is drained and never read. Shared by the diff child (reads) and the sync child
// (the one write, under --allow-writes).
import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import type { Craftar } from './craftar'

const PROTOCOL = '2025-06-18'

export interface ToolResult {
  content?: { type: string; text?: string }[]
  structuredContent?: unknown
  isError?: boolean
}

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }

export class McpSession {
  private buf = ''
  private nextId = 1
  private pending = new Map<number, Pending>()
  readonly exited: Promise<void>

  private constructor(
    private readonly proc: ChildProcessWithoutNullStreams,
    private readonly timeoutMs: number,
  ) {
    proc.stdout.setEncoding('utf8')
    proc.stdout.on('data', (chunk: string) => this.onData(chunk))
    proc.stderr.resume()
    proc.stdin.on('error', () => undefined)
    this.exited = new Promise((resolve) => {
      const done = (): void => {
        this.failAll(new Error('craftar mcp exited'))
        resolve()
      }
      proc.once('exit', done)
      proc.once('error', done)
    })
  }

  /** Starts `craftar <args>` and completes the MCP handshake; rejects when the child does not answer. */
  static async open(craftar: Craftar, args: readonly string[], timeoutMs: number): Promise<McpSession> {
    const proc = spawn(craftar.bin, [...args], { env: craftar.env, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    const s = new McpSession(proc, timeoutMs)
    try {
      await s.request('initialize', { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'craftar-orca', version: '0.1.0' } })
    } catch (e) {
      await s.stop()
      throw e
    }
    s.notify('notifications/initialized')
    return s
  }

  private onData(chunk: string): void {
    this.buf += chunk
    let i: number
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i)
      this.buf = this.buf.slice(i + 1)
      let msg: { id?: unknown; result?: unknown; error?: { message?: unknown } }
      try {
        msg = JSON.parse(line)
      } catch {
        continue
      }
      if (typeof msg.id !== 'number') continue
      const p = this.pending.get(msg.id)
      if (!p) continue
      this.pending.delete(msg.id)
      clearTimeout(p.timer)
      if (msg.error) p.reject(new Error(`craftar mcp: ${typeof msg.error.message === 'string' ? msg.error.message : 'protocol error'}`))
      else p.resolve(msg.result)
    }
  }

  private failAll(e: Error): void {
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer)
      p.reject(e)
      this.pending.delete(id)
    }
  }

  request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`craftar mcp: no answer to ${method} in ${this.timeoutMs / 1000} s`))
      }, this.timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
    })
  }

  /** One tools/call. */
  async call(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    return (await this.request('tools/call', { name, arguments: args })) as ToolResult
  }

  notify(method: string): void {
    this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method }) + '\n')
  }

  async stop(): Promise<void> {
    this.proc.stdin.end()
    const killer = setTimeout(() => this.proc.kill(), 2_000)
    await this.exited
    clearTimeout(killer)
  }
}

/** A tool result's text, its content parts joined. */
export function toolText(r: ToolResult): string {
  return (r.content ?? []).map((c) => (c.type === 'text' && typeof c.text === 'string' ? c.text : '')).join('')
}

/** A tool result's document: structuredContent, else its text parsed as JSON. */
export function toolDocument<T>(r: ToolResult): T {
  if (r.structuredContent && typeof r.structuredContent === 'object') return r.structuredContent as T
  return JSON.parse(toolText(r)) as T
}
