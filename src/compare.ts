// What the sync did, against the question the person said yes to (spec 60 §7 step 3): the `sync` tool takes
// no digest, so the files can have moved between the read and the write. Every difference is listed in
// words, never acted on; a file craftar kept because it changed while craftar was writing asks for a re-run.
export interface Asked {
  path: string
  state: string
}

// The start of craftar's CHANGED_SINCE_STATUS (craftar-cli src/core/report.ts, since 0.54.0; the same in 1.3.1).
const CHANGED_WHILE_WRITING = 'changed while craftar was writing'

export function compareWithQuestion(
  asked: readonly Asked[],
  result: { written: string[]; removed: { path: string; reason?: string }[]; skipped: { path: string; state: string; reason: string }[] },
): { differences: string[]; rerun: boolean } {
  const want = new Set(asked.map((a) => a.path))
  const removed = result.removed.map((r) => r.path)
  const done = new Set([...result.written, ...removed, ...result.skipped.map((s) => s.path)])
  const differences = [
    ...result.written.filter((p) => !want.has(p)).map((p) => `written but not in the list you agreed to: ${p}`),
    ...removed.filter((p) => !want.has(p)).map((p) => `removed but not in the list you agreed to: ${p}`),
    ...asked.filter((a) => !done.has(a.path)).map((a) => `in the list you agreed to but not written, removed or kept: ${a.path}`),
  ]
  const rerun = result.skipped.some((s) => s.reason.startsWith(CHANGED_WHILE_WRITING))
  return { differences, rerun }
}
