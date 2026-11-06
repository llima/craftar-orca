// Which `craftar` the worker starts (spec 60 O1, ruled): the `craftarPath` setting when it is set,
// an absolute path only; else the absolute entries of the worker's PATH, never a relative or empty
// entry and never `npx`. A binary under a version manager's shim directory is found and named,
// because a project's files can then choose what runs (spec 45 §20).
import { accessSync, constants, statSync } from 'node:fs'
import { delimiter, isAbsolute, join, sep } from 'node:path'

export type Shim = 'asdf' | 'volta' | 'mise'

export type Found =
  | { found: string; shim: Shim | null; reason?: undefined }
  | { found: null; shim?: undefined; reason: string }

export interface FindOptions {
  craftarPath: string
  path: string
  platform?: NodeJS.Platform
}

const SHIM_DIRS: ReadonlyArray<[Shim, string[]]> = [
  ['asdf', ['.asdf', 'shims']],
  ['volta', ['.volta', 'bin']],
  ['mise', ['mise', 'shims']],
]

export function shimOf(file: string): Shim | null {
  const parts = file.split(/[\\/]+/)
  for (const [name, seq] of SHIM_DIRS) {
    for (let i = 0; i + seq.length <= parts.length; i++) {
      if (seq.every((p, j) => parts[i + j] === p)) return name
    }
  }
  return null
}

function runnable(file: string, platform: NodeJS.Platform): boolean {
  try {
    if (!statSync(file).isFile()) return false
    if (platform !== 'win32') accessSync(file, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** A program on an absolute entry of `path` only — never a relative or empty entry (spec 60 O1). */
export function findOnPath(name: string, path: string, platform: NodeJS.Platform = process.platform): string | null {
  const file = platform === 'win32' ? `${name}.exe` : name
  for (const raw of path.split(platform === 'win32' ? ';' : delimiter)) {
    const entry = raw.replace(/^"(.*)"$/, '$1')
    if (entry === '' || !isAbsolute(entry)) continue
    const candidate = join(entry, file)
    if (runnable(candidate, platform)) return candidate
  }
  return null
}

export function findCraftar(opts: FindOptions): Found {
  const platform = opts.platform ?? process.platform
  const setting = opts.craftarPath.trim()
  if (setting !== '') {
    if (!isAbsolute(setting)) return { found: null, reason: 'craftarPath must be an absolute path' }
    if (!runnable(setting, platform)) return { found: null, reason: 'craftarPath names no runnable file' }
    return { found: setting, shim: shimOf(setting) }
  }
  const file = findOnPath('craftar', opts.path, platform)
  if (file) return { found: file, shim: shimOf(file) }
  return { found: null, reason: `craftar not found on the absolute entries of PATH (set craftarPath${sep === '\\' ? ' to craftar.exe' : ''})` }
}
