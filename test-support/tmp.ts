// Temporary directories for tests, removed after each test. A directory holding a copy of node that
// just ran can be busy on Windows for a moment (EBUSY), so removal retries (craftar-cli's lesson).
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const made: string[] = []

export function tempDir(prefix = 'craftar-orca-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  made.push(dir)
  return dir
}

// Asynchronous on purpose: a synchronous removal blocks the event loop, so a child the worker is stopping (its stdin
// closed, its kill timer set) never gets that EOF or that kill while the removal retries, and on Windows its running
// executable keeps the directory from being removed (EPERM, ENOTEMPTY).
export async function removeTempDirs(): Promise<void> {
  while (made.length > 0) {
    const dir = made.pop() as string
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  }
}

export function remaining(): number {
  return made.length
}
