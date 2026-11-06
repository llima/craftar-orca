// A file's diff (spec 60 §4, §6): craftar has no `diff --json`, so the diff comes from the `diff` tool of
// a long-lived `craftar mcp --workspace <abs dir>` child, started on the first diff — never with --fetch
// (it reads the cached copy) and never with --allow-writes. JSON-RPC over newline-delimited stdio. The
// child is pinned to the forge, ref and profile it started with: on PIN_CHANGED it is restarted once and
// the call retried. Any other tool error is craftar's refusal, relayed in its words. stderr is not read.
import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import { isAbsolute } from 'node:path'
import type { Craftar, FileState } from './craftar'

const PROTOCOL = '2025-06-18'
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

interface ToolResult {
  content?: { type: string; text?: string }[]
  structuredContent?: unknown
  isError?: boolean
}

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }

class Session {
  private buf = ''
  private nextId = 1
  private pending = new Map<number, Pending>()
  readonly exited: Promise<void>

  constructor(private readonly proc: ChildProcessWithoutNullStreams) {
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
        reject(new Error(`craftar mcp: no answer to ${method} in ${CALL_TIMEOUT_MS / 1000} s`))
      }, CALL_TIMEOUT_MS)
      this.pending.set(id, { resolve, reject, timer })
      this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
    })
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

export class DiffChild {
  private session: Promise<Session> | null = null

  constructor(
    private readonly craftar: Craftar,
    private readonly ws: string,
  ) {
    if (!isAbsolute(ws)) throw new Error('craftar is given an absolute workspace directory only')
  }

  private start(): Promise<Session> {
    if (this.session) return this.session
    const proc = spawn(this.craftar.bin, ['mcp', '--workspace', this.ws], {
      env: this.craftar.env,
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const s = new Session(proc)
    this.session = s
      .request('initialize', { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'craftar-orca', version: '0.1.0' } })
      .then(() => {
        s.notify('notifications/initialized')
        return s
      })
    this.session.catch(() => {
      this.session = null
    })
    return this.session
  }

  private async callDiff(path: string): Promise<ToolResult> {
    const s = await this.start()
    return (await s.request('tools/call', { name: 'diff', arguments: { path } })) as ToolResult
  }

  async diff(path: string): Promise<DiffResult> {
    let r = await this.callDiff(path)
    if (r.isError && toolText(r).startsWith(PIN_CHANGED_START)) {
      await this.stop()
      r = await this.callDiff(path)
    }
    if (r.isError) throw new DiffRefused(toolText(r))
    if (r.structuredContent && typeof r.structuredContent === 'object') return r.structuredContent as DiffResult
    return JSON.parse(toolText(r)) as DiffResult
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

function toolText(r: ToolResult): string {
  return (r.content ?? []).map((c) => (c.type === 'text' && typeof c.text === 'string' ? c.text : '')).join('')
}
