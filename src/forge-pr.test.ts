// S3b's pure part: the branch and title offered and checked, the commands per shell (quoted, markers with a nonce, exactly the
// paths), and what the plugin keeps of a terminal: the marker's verdict, the identity, the branch, the PR URL.
import { assert, test } from 'orca/testing'
import { branchFault, defaultBranch, defaultTitle, marker, prBody, readStep, remoteHost, stepCommand, titleFault } from './forge-pr'

const I = { forge: '/home/acme/forge', nonce: 'n1', branch: 'craftar-acme-portal-commit-conventions', title: "chore(forge): it's done", body: 'a body', paths: ['ingredients/rules/x/rule.md', 'recipes/a b.yaml'] }

test('the branch offered holds only [a-z0-9-]; the branch and title checks', () => {
  assert.equal(defaultBranch('acme-portal', 'rule/commit-conventions'), 'craftar-acme-portal-commit-conventions')
  assert.equal(defaultBranch('Acme Portal', 'rule/Foo_Bar'), 'craftar-acme-portal-foo-bar')
  assert.ok(defaultBranch('a'.repeat(80), 'rule/x').length <= 63)
  assert.equal(branchFault('ok-branch-1'), null)
  for (const b of ['Bad', '-x', 'a/b', 'a b', "a'b", '']) assert.ok(branchFault(b), b)
  assert.equal(defaultTitle('rule/x--acme', 'acme-portal'), 'chore(forge): rule/x--acme from acme-portal')
  assert.equal(titleFault('fine'), null)
  assert.ok(titleFault(''))
  assert.ok(titleFault('a\nb'))
  assert.ok(titleFault('x'.repeat(201)))
})

test('the body is one line of refs, paths and a count', () => {
  const b = prBody({ outcome: 'variant', promoted: 'rule/x--acme', written: [{ path: 'ingredients/rules/x--acme/rule.md', action: 'created' }], others: 2, workspaceName: 'acme-portal' })
  assert.doesNotMatch(b, /\n/)
  assert.match(b, /ingredients\/rules\/x--acme\/rule\.md \(created\)/)
  assert.match(b, /2 other registered workspaces see it/)
})

test('the commit command: a new branch, exactly those paths added and committed, every value quoted, markers last', () => {
  const c = stepCommand('bash', 'commit', I)!
  assert.match(c, /^git -C '\/home\/acme\/forge' var GIT_AUTHOR_IDENT && /)
  assert.match(c, /switch -c craftar-acme-portal-commit-conventions && /)
  assert.match(c, /add -- 'ingredients\/rules\/x\/rule\.md' 'recipes\/a b\.yaml' && /)
  assert.match(c, /commit -m 'chore\(forge\): it'\\''s done' -- 'ingredients\/rules\/x\/rule\.md' 'recipes\/a b\.yaml' && /)
  assert.ok(c.endsWith(` && echo ${marker('commit', 'n1', true)} || echo ${marker('commit', 'n1', false)}`))
  assert.doesNotMatch(c, / -A\b| --all\b|push|sendText/)
})

test('push and PR are their own commands; PowerShell gets its own quoting; a value that cannot go in gives no command', () => {
  assert.match(stepCommand('bash', 'push', I)!, /^git -C '\/home\/acme\/forge' push -u origin craftar-acme-portal-commit-conventions && echo/)
  const pr = stepCommand('zsh', 'pr', I)!
  assert.match(pr, /^cd '\/home\/acme\/forge' && gh pr create --head craftar-acme-portal-commit-conventions --title 'chore\(forge\): it'\\''s done' --body 'a body' && /)
  assert.match(stepCommand('pwsh', 'commit', I)!, /commit -m 'chore\(forge\): it''s done'/)
  assert.equal(stepCommand('bash', 'commit', { ...I, branch: 'Bad; rm -rf /' }), null)
  assert.equal(stepCommand('bash', 'pr', { ...I, title: 'a\nb' }), null)
  assert.equal(stepCommand('bash', 'commit', { ...I, paths: [] }), null)
  assert.equal(stepCommand('bash', 'commit', { ...I, paths: ['a\nb'] }), null)
  assert.match(stepCommand('bash', 'prepare', I)!, /var GIT_AUTHOR_IDENT && echo craftar-branch:\$\(git -C '\/home\/acme\/forge' rev-parse --abbrev-ref HEAD\)/)
})

test('a marker counts only as a whole line with its nonce; the identity, the branch and the PR URL of the Forge\'s host are kept', () => {
  const cmd = `$ ${stepCommand('bash', 'pr', I)}`
  assert.equal(readStep([cmd], 'pr', 'n1', 'github.com').done, null)
  assert.equal(readStep(['craftar-step-ok:pr:old'], 'pr', 'n1', 'github.com').done, null)
  const r = readStep([cmd, 'https://github.com/acme/forge/pull/7', `  ${marker('pr', 'n1', true)}`], 'pr', 'n1', 'github.com')
  assert.deepEqual(r, { done: 'ok', identity: null, branch: null, url: 'https://github.com/acme/forge/pull/7' })
  assert.equal(readStep(['https://evil.example/acme/forge/pull/7', marker('pr', 'n1', true)], 'pr', 'n1', 'github.com').url, null)
  assert.equal(readStep([marker('commit', 'n1', false)], 'commit', 'n1', null).done, 'failed')
  const p = readStep(['Acme Dev <dev@acme.example> 1794150445 -0300', 'craftar-branch:main', marker('prepare', 'n1', true)], 'prepare', 'n1', null)
  assert.equal(p.identity, 'Acme Dev <dev@acme.example>')
  assert.equal(p.branch, 'main')
})

test("the Forge remote's host, from https or ssh", () => {
  assert.equal(remoteHost('https://github.com/acme/forge.git'), 'github.com')
  assert.equal(remoteHost('git@github.com:acme/forge.git'), 'github.com')
  assert.equal(remoteHost('ssh://git@git.acme.example/acme/forge.git'), 'git.acme.example')
  assert.equal(remoteHost('/home/acme/forge'), null)
})
