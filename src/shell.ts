// The shell a terminal runs (spec 60 O12, §10): a terminal command is a shell string, so every value in it is
// quoted for that shell. The probe is a fixed, harmless command whose answer differs per shell — its own name
// for bash, zsh and sh, nothing for PowerShell (an unset variable), the literal `$0` for cmd — read back from
// the probe terminal (terminal.read returns its lines, measured in Orca 1.4.250). cmd's quoting is S4's
// (§11), and a shell the probe does not recognise gets no terminal: the panel shows the steps in words.
export type Shell = 'bash' | 'zsh' | 'sh' | 'pwsh' | 'cmd' | 'unknown'

export const PROBE_SHELL_COMMAND = 'echo craftar-shell:$0'
const MARK = 'craftar-shell:'

export function detectShell(lines: readonly string[]): Shell {
  const answer = lines.map((l) => l.trim()).find((l) => l.startsWith(MARK))
  if (answer === undefined) return 'unknown'
  const v = answer.slice(MARK.length)
  if (v === '') return 'pwsh'
  if (v === '$0') return 'cmd'
  const name = v.replace(/^-/, '').split('/').pop() ?? ''
  if (name === 'bash') return 'bash'
  if (name === 'zsh') return 'zsh'
  if (name === 'sh' || name === 'dash') return 'sh'
  return 'unknown'
}

export function quote(shell: 'bash' | 'zsh' | 'sh' | 'pwsh', value: string): string {
  return shell === 'pwsh' ? `'${value.replace(/'/g, "''")}'` : `'${value.replace(/'/g, `'\\''`)}'`
}

/**
 * The command the consent terminal runs (O2): the person's own craftar, `mcp allow-writes --workspace <dir>`,
 * CRAFTAR_HOME set for it when the setting gives one. null for a shell this slice cannot quote for.
 */
export function allowWritesCommand(shell: Shell, craftar: { bin: string; home: string }, ws: string): string | null {
  if (shell === 'cmd' || shell === 'unknown') return null
  const run = `${shell === 'pwsh' ? '& ' : ''}${quote(shell, craftar.bin)} mcp allow-writes --workspace ${quote(shell, ws)}`
  const home = craftar.home.trim()
  if (home === '') return run
  return shell === 'pwsh' ? `$env:CRAFTAR_HOME=${quote(shell, home)}; ${run}` : `CRAFTAR_HOME=${quote(shell, home)} ${run}`
}
