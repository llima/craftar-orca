// P4 (the install test of 2026-11-09): a drift promote refusal for a file of the Forge's shared base is recognised, in the
// words of craftar 1.9.0 and in the words craftar-cli's C4 gives them (llima/craftar-cli, agent 82, commit e082619).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fromSharedBase } from './shared-base'

const P = '.claude/rules/workflow.md'
const WAYS = `edit it in a clone of the Forge and open a pull request there, or keep the Forge's text with \`craftar drift discard ${P}\``
const SHARED = `the Forge shares it with other profiles, so only the Forge's maintainers change it: ${WAYS}`

// craftar 1.9.0 (craftar-cli src/importers/drift-promote.ts), each as stderr prints it.
const V190: Record<string, string> = {
  D10: 'error: rule/workflow is also used by profile acme-api — its files would change there',
  D16_OTHER_PROFILE: 'error: promote would change /home/acme/api (profile acme-api): .claude/rules/workflow.md — the Forge was left untouched',
  D17: 'error: recipe acme-base reaches this workspace through acme-web → acme-base — promote does not fork a recipe chain; re-import the workspace or edit the recipes by hand',
  D17_PARENT: `error: ${P}: recipe acme-base reaches acme-web through profile acme, which it extends — forking it would edit acme's recipes, and no command writes a parent: edit the Forge by hand`,
  D18: `error: ${P} comes from recipe pm-jira, which profile acme-web selects through integrations.pm — edit rule/jira in the Forge, or \`craftar drift discard ${P}\``,
  D19: `error: ${P} reaches this workspace through recipe pm-jira, which profile acme-web selects through integrations.pm and another profile also resolves — promote cannot fork a recipe a block selects; edit rule/jira in the Forge, or \`craftar drift discard ${P}\``,
  D19_UNRESOLVED: `error: ${P} reaches this workspace through recipe pm-jira, which profile acme-web selects through integrations.pm, and profile acme-api does not resolve, so promote cannot tell whether it also uses it — promote cannot fork a recipe a block selects; fix profile acme-api, edit rule/jira in the Forge, or \`craftar drift discard ${P}\``,
  D24: `error: ${P} comes from rule/workflow, local to acme, which acme-web extends (profiles/acme/ingredients/rules/workflow) — no command writes a parent: edit it there by hand, then sync every workspace of the family`,
}

// The C4 texts (agent 82's report, "C4 final texts").
const C4: Record<string, string> = {
  D10: `error: rule/workflow is also used by profile acme-api — its files would change there; ${SHARED}`,
  D16_OTHER_PROFILE: `error: promote would change /home/acme/api (profile acme-api): ${P} — the Forge was left untouched; ${SHARED}`,
  D17: `error: recipe acme-base reaches this workspace through acme-web → acme-base — promote does not fork a recipe chain; the recipe is shared in the Forge, so only the Forge's maintainers change it: ask them for a variant for this profile, or ${WAYS}`,
  D17_PARENT: `error: ${P}: recipe acme-base reaches acme-web through profile acme, which it extends — forking it would edit acme's recipes, and no command writes a parent: only the Forge's maintainers change a parent's recipes, so ask them for a variant for this profile, or ${WAYS}`,
  D19: `error: ${P} reaches this workspace through recipe pm-jira, which profile acme-web selects through integrations.pm and another profile also resolves — promote cannot fork a recipe a block selects; the recipe is shared, so only the Forge's maintainers change it: edit rule/jira in a clone of the Forge and open a pull request there, or \`craftar drift discard ${P}\``,
  D19_UNRESOLVED: `error: ${P} reaches this workspace through recipe pm-jira, which profile acme-web selects through integrations.pm, and profile acme-api does not resolve, so promote cannot tell whether it also uses it — promote cannot fork a recipe a block selects; fix profile acme-api, edit rule/jira in a clone of the Forge and open a pull request there, or \`craftar drift discard ${P}\``,
}

for (const [id, text] of Object.entries(V190)) {
  test(`craftar 1.9.0's ${id} is a refusal for a file of the shared base`, () => assert.equal(fromSharedBase(text), true))
}
for (const [id, text] of Object.entries(C4)) {
  test(`C4's ${id} is a refusal for a file of the shared base`, () => assert.equal(fromSharedBase(text), true))
}

test("the stable phrase alone is enough, whatever the rest of craftar's words", () => {
  assert.equal(fromSharedBase("error: something new — only the Forge's maintainers change it"), true)
})

test('other refusals are not: the same profile, a file already in the Forge, the Forge moved, a remote Forge', () => {
  for (const text of [
    `error: promote would change /home/acme/web beyond rule/workflow: ${P} — the Forge was left untouched`,
    `error: promote would change /home/acme (profile x): y beyond rule/workflow: ${P} — the Forge was left untouched`,
    `error: profiles/acme-web/ingredients/rules/workflow/rule.md already exists in the Forge — promote does not overwrite it`,
    `error: the Forge changed rule/workflow since the last sync (${P}: update) — a variant taken from the disk would undo that change for profile acme-web; sync the rest, redo the edit on top, and promote again`,
    'error: the Forge of this workspace is remote, read from a cache craftar never writes — pass `--forge <your clone>`',
    '',
  ]) assert.equal(fromSharedBase(text), false, text)
})
