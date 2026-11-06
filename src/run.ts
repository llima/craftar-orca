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

export function run(file: string, args: readonly string[], env: NodeJS.ProcessEnv, timeoutMs = 30_000): Promise<RunResult> {
  return new Promise((resolve) => {
    execFile(file, [...args], { env, timeout: timeoutMs, shell: false, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : null) : 0
      resolve({ code, stdout: String(stdout), stderr: String(stderr) })
    })
  })
}
