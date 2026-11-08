// S4 (spec 60 §11): a craftar.cmd named by craftarPath on Windows runs through cmd, every value in double quotes, and a value cmd
// would read inside quotes refuses the run in words. Every other program, and every other platform, gets the argument array as is.
import { assert, test } from 'orca/testing'
import { CMD_REFUSED, invocation } from './run'
import { allowWritesCommand } from './shell'

const ENV = { ComSpec: 'C:\\Windows\\system32\\cmd.exe' }
const SHIM = 'C:\\Users\\acme dev\\AppData\\Roaming\\npm\\craftar.cmd'

test('a .cmd on Windows: cmd /d /s /c with one quoted line, verbatim', () => {
  const how = invocation(SHIM, ['status', '--json', '--workspace', 'C:\\Program Files (x86)\\acme\\web'], 'win32', ENV)
  assert.deepEqual(how, {
    file: 'C:\\Windows\\system32\\cmd.exe',
    args: ['/d', '/s', '/c', '""C:\\Users\\acme dev\\AppData\\Roaming\\npm\\craftar.cmd" "status" "--json" "--workspace" "C:\\Program Files (x86)\\acme\\web""'],
    verbatim: true,
  })
})

test('a value cmd would read inside quotes refuses the run, naming no value', () => {
  for (const bad of ['C:\\a%PATH%\\b', 'a!b', 'say "hi"', 'a^b', 'a&b', 'a|b', 'a<b', 'a>b', 'a\nb']) {
    const how = invocation(SHIM, ['status', '--workspace', bad], 'win32', ENV)
    assert.ok('refused' in how, bad)
    if ('refused' in how) assert.ok(!how.refused.includes(bad))
  }
})

test('anything else is started as it is: another platform, an .exe, a .bat only on Windows', () => {
  assert.deepEqual(invocation('/usr/bin/craftar', ['status'], 'linux', ENV), { file: '/usr/bin/craftar', args: ['status'], verbatim: false })
  assert.deepEqual(invocation('C:\\craftar\\craftar.exe', ['status'], 'win32', ENV), { file: 'C:\\craftar\\craftar.exe', args: ['status'], verbatim: false })
  assert.deepEqual(invocation('/opt/x/craftar.cmd', ['status'], 'linux', ENV), { file: '/opt/x/craftar.cmd', args: ['status'], verbatim: false })
  assert.equal((invocation('C:\\x\\craftar.bat', ['status'], 'win32', ENV) as { verbatim: boolean }).verbatim, true)
})

test('cmd is found from ComSpec when it is an absolute Windows path, else under SystemRoot', () => {
  assert.equal((invocation(SHIM, [], 'win32', { SystemRoot: 'D:\\Win' }) as { file: string }).file, 'D:\\Win\\System32\\cmd.exe')
  assert.equal((invocation(SHIM, [], 'win32', { ComSpec: 'cmd.exe', SystemRoot: 'D:\\Win' }) as { file: string }).file, 'D:\\Win\\System32\\cmd.exe')
})

test('a value ending in a backslash (a drive root) is refused: cmd would hand node a quote, not the end of the value', () => {
  assert.ok('refused' in invocation(SHIM, ['status', '--workspace', 'D:\\'], 'win32', ENV))
  assert.ok(!('refused' in invocation(SHIM, ['status', '--workspace', 'D:\\acme'], 'win32', ENV)))
})

test('a refusal is the one fixed wording, which run() hands back as stderr with no exit code', () => {
  // On this platform run() starts a .cmd as it is, so the refusal is checked on the pure function run() and the mcp session use.
  const how = invocation(SHIM, ['--workspace', 'C:\\a&b'], 'win32', ENV)
  assert.deepEqual(how, { refused: CMD_REFUSED })
})

test("the consent terminal for a craftar.cmd: a value cmd cannot carry gives no command (the steps in words)", () => {
  const ok = allowWritesCommand('pwsh', { bin: SHIM, home: '' }, 'C:\\acme\\web')
  assert.match(ok ?? '', /^& 'C:\\Users\\acme dev\\AppData\\Roaming\\npm\\craftar\.cmd' mcp allow-writes --workspace 'C:\\acme\\web'$/)
  assert.equal(allowWritesCommand('pwsh', { bin: SHIM, home: '' }, 'C:\\acme&calc'), null)
  assert.equal(allowWritesCommand('pwsh', { bin: SHIM, home: '' }, 'C:\\%TEMP%\\web'), null)
  assert.equal(allowWritesCommand('pwsh', { bin: SHIM, home: '' }, 'D:\\'), null)
  // An .exe is not read by cmd: PowerShell's quoting stands.
  assert.notEqual(allowWritesCommand('pwsh', { bin: 'C:\\craftar\\craftar.exe', home: '' }, 'C:\\acme&calc'), null)
})
