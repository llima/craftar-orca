// The shell a terminal runs (spec 60 O12): a fixed, harmless probe command whose answer differs per shell,
// read back from the probe terminal; every value put into a terminal command is quoted for that shell, and a
// shell the probe does not recognise gets no terminal.
import { assert, test } from 'orca/testing'
import { allowWritesCommand, detectShell, PROBE_SHELL_COMMAND, quote } from './shell'

test('the probe answer names the shell; anything else is unknown', () => {
  const at = (line: string) => detectShell(['acme-user@acme-host:/tmp/acme$ echo craftar-shell:$0', line])
  assert.equal(at('craftar-shell:bash'), 'bash')
  assert.equal(at('craftar-shell:-bash'), 'bash')
  assert.equal(at('craftar-shell:/bin/zsh'), 'zsh')
  assert.equal(at('craftar-shell:sh'), 'sh')
  assert.equal(at('craftar-shell:dash'), 'sh')
  assert.equal(at('craftar-shell:'), 'pwsh')
  assert.equal(at('craftar-shell:$0'), 'cmd')
  assert.equal(at('craftar-shell:fish'), 'unknown')
  assert.equal(detectShell(['fish: $0 is not supported']), 'unknown')
  assert.equal(detectShell([]), 'unknown')
  assert.equal(PROBE_SHELL_COMMAND, 'echo craftar-shell:$0')
})

test('POSIX shells quote with single quotes, a quote closed and escaped; pwsh doubles it', () => {
  assert.equal(quote('bash', "/home/acme/it's here"), `'/home/acme/it'\\''s here'`)
  assert.equal(quote('pwsh', "C:\\acme\\it's here"), `'C:\\acme\\it''s here'`)
})

test('the allow-writes command names the craftar binary and the workspace, quoted, and CRAFTAR_HOME when set', () => {
  assert.equal(
    allowWritesCommand('bash', { bin: '/opt/acme tools/craftar', home: "/home/acme/c'home" }, "/home/acme/it's web"),
    `CRAFTAR_HOME='/home/acme/c'\\''home' '/opt/acme tools/craftar' mcp allow-writes --workspace '/home/acme/it'\\''s web'`,
  )
  assert.equal(allowWritesCommand('zsh', { bin: '/usr/bin/craftar', home: '' }, '/home/acme/web'), `'/usr/bin/craftar' mcp allow-writes --workspace '/home/acme/web'`)
  assert.equal(
    allowWritesCommand('pwsh', { bin: 'C:\\acme\\craftar.exe', home: "C:\\h'o" }, 'C:\\acme\\web'),
    `$env:CRAFTAR_HOME='C:\\h''o'; & 'C:\\acme\\craftar.exe' mcp allow-writes --workspace 'C:\\acme\\web'`,
  )
  assert.equal(allowWritesCommand('cmd', { bin: 'C:\\craftar.exe', home: '' }, 'C:\\web'), null)
  assert.equal(allowWritesCommand('unknown', { bin: '/usr/bin/craftar', home: '' }, '/web'), null)
})

test("PowerShell's typographic single quotes are doubled too: a path holding one cannot close the quote", () => {
  assert.equal(quote('pwsh', 'C:\\acme\\Luiz\u2019s web'), `'C:\\acme\\Luiz\u2019\u2019s web'`)
  assert.equal(quote('pwsh', 'a\u2018b\u201Ac\u201Bd'), `'a\u2018\u2018b\u201A\u201Ac\u201B\u201Bd'`)
})

test('a value holding a control character gets no command at all', () => {
  assert.equal(allowWritesCommand('bash', { bin: '/usr/bin/craftar', home: '' }, '/home/acme/we\nb'), null)
  assert.equal(allowWritesCommand('pwsh', { bin: 'C:\\craftar.exe', home: 'C:\\h\r' }, 'C:\\web'), null)
})
