// Temporary directories for tests, removed after each test. A directory holding a copy of node that
// just ran can be busy on Windows for a moment (EBUSY), so removal retries (craftar-cli's lesson).
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const made: string[] = []

export function tempDir(prefix = 'craftar-orca-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  made.push(dir)
  return dir
}

export function removeTempDirs(): void {
  while (made.length > 0) {
    const dir = made.pop() as string
    rmSync(dir, { recursive: true, force: true, maxRetries: 6, retryDelay: 200 })
  }
}

export function remaining(): number {
  return made.length
}
