// P4 (the install test of 2026-11-09): whether a `craftar drift promote` refusal is about a file of the Forge's shared base,
// which only the Forge's maintainers change. craftar's refusals are text, not a contract, so the recognition is pinned by a
// test per message: the stable phrase craftar-cli's C4 put in every such refusal, and the words of craftar 1.9.0, kept so a
// new plugin reads an older craftar the same way. A refusal no pattern reads keeps craftar's words alone: never a wrong line.

// C4 (llima/craftar-cli, agent 82, e082619): in D10, D16 (another profile), D17, D17 under a parent and D19.
const STABLE = "only the Forge's maintainers change"

// craftar 1.9.0 (craftar-cli src/importers/drift-promote.ts at bd9e53e). D19_UNRESOLVED keeps its 1.9.0 phrase after C4.
const V190: readonly RegExp[] = [
  / is also used by profile \S+ — its files would change there/, // D10
  // D16, another profile; the same profile's D16 says "beyond <ingredient>:" instead, so a path holding "(profile" is not read as one.
  /promote would change (?:(?! beyond ).)+ \(profile [^)]*\): (?:(?! beyond ).)+ — the Forge was left untouched/,
  /promote does not fork a recipe chain/, // D17
  /no command writes a parent/, // D17 under a parent, D24
  /which profile \S+ selects through integrations\./, // D18, D19, D19_UNRESOLVED
]

export function fromSharedBase(words: string): boolean {
  return words.includes(STABLE) || V190.some((r) => r.test(words))
}

/** The one plain line under craftar's words: the ways out are the ones craftar names (C4's WAYS_OUT). */
export const SHARED_BASE_LINE =
  "This file comes from the Forge's shared base: only the Forge's maintainers change it there. Propose the change in a pull request to the Forge, or keep the Forge's text with Discard."
