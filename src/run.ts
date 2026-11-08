// Starting a child: always an argument array, never a shell (spec 60 §10). The environment is the
// worker's own plus CRAFTAR_HOME from the setting when it is set (O1).
import { execFile } from 'node:child_process'

export interface RunResult {
  code: number | null
  stdout: string
  stderr: string
}

export function childEnv(base: NodeJS.ProcessEnv, craftarHome: string): NodeJS.ProcessEnv {
  const env = { ...base }
  if (craftarHome.trim() !== '') env.CRAFTAR_HOME = craftarHome.trim()
  return env
}

// S4 (spec 60 §11): on Windows, npm installs craftar as `craftar.cmd`, a batch shim that only cmd can run. When craftarPath names
// a .cmd or .bat, the child is cmd itself, `/d /s /c "<line>"`, the line built here: every value in double quotes, and a value cmd
// would read inside quotes (`%` and `!` expand, `"` ends the quote, `^`, `&`, `|`, `<`, `>`, a control character) refuses the run in
// words rather than being escaped. No other program goes through cmd.
const CMD_UNSAFE = /["%!^&|<>\u0000-\u001f\u007f]/

export type Invocation = { file: string; args: string[]; verbatim: boolean } | { refused: string }

export function invocation(file: string, args: readonly string[], platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): Invocation {
  if (platform !== 'win32' || !/\.(cmd|bat)$/i.test(file)) return { file, args: [...args], verbatim: false }
  const values = [file, ...args]
  if (values.some((v) => CMD_UNSAFE.test(v))) {
    return { refused: 'a value holds a character cmd cannot pass to craftar.cmd safely (" % ! ^ & | < > or a control character): nothing was started' }
  }
  const comspec = env.ComSpec ?? env.COMSPEC ?? ''
  const root = env.SystemRoot ?? env.SYSTEMROOT ?? 'C:\\Windows'
  const cmd = /^[A-Za-z]:\\/.test(comspec) ? comspec : `${root}\\System32\\cmd.exe`
  const line = values.map((v) => `"${v}"`).join(' ')
  return { file: cmd, args: ['/d', '/s', '/c', `"${line}"`], verbatim: true }
}

/** `input`, when given, is written to the child's stdin, which is then closed. */
export function run(file: string, args: readonly string[], env: NodeJS.ProcessEnv, timeoutMs = 30_000, input?: string): Promise<RunResult> {
  const how = invocation(file, args)
  if ('refused' in how) return Promise.resolve({ code: null, stdout: '', stderr: how.refused })
  return new Promise((resolve) => {
    const child = execFile(how.file, how.args, { env, timeout: timeoutMs, shell: false, windowsHide: true, windowsVerbatimArguments: how.verbatim, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : null) : 0
      resolve({ code, stdout: String(stdout), stderr: String(stderr) })
    })
    if (input !== undefined) {
      child.stdin?.on('error', () => undefined)
      child.stdin?.end(input)
    }
  })
}
