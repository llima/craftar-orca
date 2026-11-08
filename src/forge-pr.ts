// S3b (spec 60 §8 step 4, O6; the user's decisions of 2026-11-08): after Send wrote the Forge's working tree, a PR in the Forge
// in three clicks, each in a visible Orca terminal the plugin opens with a fixed command (it never types into a terminal):
// prepare (the identity git will use and the Forge's current branch, read in a terminal like the commit's), 1 branch and commit,
// 2 push, 3 open the PR with gh. Each command ends with a marker the shell prints, carrying a nonce, so the plugin reads the
// terminal's last lines to know the step finished; of those lines it keeps only the identity, the branch and the PR URL.
// Pure: no I/O. A value reaches a command quoted for the probed shell, or limited to a safe class (a branch: [a-z0-9-]).
import { quote, type Shell } from './shell'

export type Step = 'prepare' | 'commit' | 'push' | 'pr'
export type Quotable = 'bash' | 'zsh' | 'sh' | 'pwsh'

const BRANCH = /^[a-z0-9][a-z0-9-]{0,62}$/
// A control character (C0, DEL, C1) or a bidirectional control has no place in a terminal command, even quoted.
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/

export function quotable(shell: Shell): shell is Quotable {
  return shell === 'bash' || shell === 'zsh' || shell === 'sh' || shell === 'pwsh'
}

/** The branch the plugin offers: `craftar-<profile>-<ingredient name>`, only [a-z0-9-], at most 63 characters. */
export function defaultBranch(profile: string, ingredient: string): string {
  const name = ingredient.split('/').pop() ?? ingredient
  const slug = `craftar-${profile}-${name}`.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
  return slug.slice(0, 63).replace(/-$/, '') || 'craftar-forge-change'
}

export function branchFault(branch: string): string | null {
  return BRANCH.test(branch) ? null : 'a branch name holds only lowercase letters, digits and hyphens, starting with a letter or a digit (at most 63)'
}

/** The commit subject and PR title the plugin offers, editable in the preview. */
export function defaultTitle(promoted: string, workspaceName: string): string {
  return `chore(forge): ${promoted} from ${workspaceName}`
}

export function titleFault(title: string): string | null {
  if (title.trim() === '') return 'the title is empty'
  if (title.length > 200) return 'the title is longer than 200 characters'
  if (CONTROL.test(title)) return 'the title holds a control character'
  return null
}

/** The PR body, written by the plugin from craftar's result: refs, paths and a count, one line (a terminal command stays one line). */
export function prBody(r: { outcome: string; promoted: string; written: { path: string; action: string }[]; others: number; workspaceName: string }): string {
  const files = r.written.map((w) => `${w.path} (${w.action})`).join(', ')
  const others = r.others === 0 ? 'no other registered workspace sees it' : `${r.others} other registered workspace${r.others === 1 ? '' : 's'} see it on their next sync`
  return `Sent from the workspace ${r.workspaceName} with craftar drift promote (the craftar plugin for Orca). Outcome: ${r.outcome}, ${r.promoted}. Files: ${files}. After it: ${others}.`
}

export function marker(step: Step, nonce: string, ok: boolean): string {
  return `craftar-step-${ok ? 'ok' : 'failed'}:${step}:${nonce}`
}

// The marker as the command prints it: the verdict word is quoted apart, so the marker never stands in one piece in the
// command line itself, even when the terminal wraps that line (bash, zsh, sh and PowerShell all join `a"b"c` into `abc`).
function printed(step: Step, nonce: string, ok: boolean): string {
  return `echo craftar-step-"${ok ? 'ok' : 'failed'}":${step}:${nonce}`
}

/** What a step's terminal printed, as far as the plugin keeps it: the marker's verdict, the identity, the branch, the PR URL. */
export interface StepRead {
  done: 'ok' | 'failed' | null
  identity: string | null
  branch: string | null
  url: string | null
}

const IDENT = /^(.+ <[^<>]*>) \d+ [+-]\d{4}$/
// What git prints for a branch: no space, no `$(` (a wrapped row of the prepare command itself never reads as one).
const BRANCH_LINE = /^craftar-branch:([^\s$()]+)$/

/**
 * Reads a step's terminal lines. A marker counts only as a whole line (the echoed command line holds it inside a longer one).
 * The PR URL is a line that is exactly a pull request URL of the Forge's host.
 */
export function readStep(lines: readonly string[], step: Step, nonce: string, host: string | null): StepRead {
  const trimmed = lines.map((l) => l.trim())
  const done = trimmed.includes(marker(step, nonce, true)) ? 'ok' : trimmed.includes(marker(step, nonce, false)) ? 'failed' : null
  const identity = [...trimmed].reverse().map((l) => IDENT.exec(l)?.[1]).find((x) => x !== undefined) ?? null
  const branch = [...trimmed].reverse().map((l) => BRANCH_LINE.exec(l)?.[1]).find((x) => x !== undefined && x !== '') ?? null
  const pull = host ? new RegExp(`^https://${host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/[A-Za-z0-9._-]+/[A-Za-z0-9._-]+/pull/\\d+$`) : null
  const url = pull ? ([...trimmed].reverse().find((l) => pull.test(l)) ?? null) : null
  return { done, identity, branch, url }
}

/** The host of a git remote URL (https or scp-like ssh), for the PR URL check; null when it reads as neither. */
export function remoteHost(url: string): string | null {
  const https = /^https:\/\/(?:[^@/]+@)?([A-Za-z0-9.-]+)(?::\d+)?\//.exec(url)
  if (https) return https[1]
  const ssh = /^(?:ssh:\/\/)?[A-Za-z0-9._-]+@([A-Za-z0-9.-]+)[:/]/.exec(url)
  return ssh ? ssh[1] : null
}

export interface StepInput {
  forge: string
  nonce: string
  branch: string
  title: string
  body: string
  paths: string[]
}

/**
 * The command a step's terminal runs, for a shell the plugin quotes for; null when a value cannot go into one.
 * prepare: the identity and the Forge's current branch (writes nothing). commit: a new branch, then exactly those paths added
 * and committed (`git commit -- <paths>`, so nothing else staged goes in), then the commit's author printed. push: that branch
 * to origin. pr: `gh pr create` from the Forge's folder.
 */
export function stepCommand(shell: Quotable, step: Step, i: StepInput): string | null {
  const values = [i.forge, i.branch, i.title, i.body, ...i.paths]
  if (values.some((v) => CONTROL.test(v))) return null
  if (step !== 'prepare' && branchFault(i.branch)) return null
  if ((step === 'commit' || step === 'pr') && titleFault(i.title)) return null
  if (step === 'commit' && i.paths.length === 0) return null
  const q = (v: string): string => quote(shell, v)
  const git = `git -C ${q(i.forge)}`
  // A path is matched literally, never as a pathspec pattern: exactly the paths craftar wrote.
  const lit = `git --literal-pathspecs -C ${q(i.forge)}`
  const ok = printed(step, i.nonce, true)
  const bad = printed(step, i.nonce, false)
  const paths = i.paths.map(q).join(' ')
  const run = (() => {
    switch (step) {
      case 'prepare':
        return `${git} var GIT_AUTHOR_IDENT && echo craftar-branch:$(${git} rev-parse --abbrev-ref HEAD)`
      case 'commit':
        return `${git} var GIT_AUTHOR_IDENT && ${git} switch -c ${i.branch} && ${lit} add -- ${paths} && ${lit} commit -m ${q(i.title)} -- ${paths} && ${git} log -1 --format=%an%x20%x3C%ae%x3E%x200%x20+0000`
      case 'push':
        return `${git} push -u origin ${i.branch}`
      case 'pr':
        return `cd ${q(i.forge)} && gh pr create --head ${i.branch} --title ${q(i.title)} --body ${q(i.body)}`
    }
  })()
  return `${run} && ${ok} || ${bad}`
}
