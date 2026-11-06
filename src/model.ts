// What the panel draws and the status bar says, built only from craftar's documents (spec 60 §4, §6).
// Every warning craftar gave is kept in its words; nothing here decides anything craftar did not say.
// A model holds paths, states, counts and craftar's own lines — never a file's content.
import type { DriftDoc, FileState, ReposDoc, StatusDoc, UnsetParam, WorkspacesDoc } from './craftar'

const PENDING: readonly string[] = ['new', 'update', 'adopt', 'orphan']
const APART: readonly string[] = ['collision', 'orphan-drift']

export interface PanelModel {
  ws: string
  name: string
  forge: {
    source: string | null
    ref: string | null
    commit: string | null
    lockCommit: string | null
    profile: string | null
    freshness: 'local' | 'fetched' | 'cached'
    fetchedAt: number | null
  } | null
  outputs: { owner: string; counts: Record<string, number> }[]
  pending: { path: string; state: FileState }[]
  edited: { path: string; state: FileState; promotable: boolean; reason: string | null }[]
  apart: { path: string; state: FileState }[]
  repos: { name: string; path: string; state: string; reason: string | null }[]
  siblings: { name: string; path: string; status: string; forgeMoved: boolean }[]
  warnings: string[]
  unset: UnsetParam[]
  refused: boolean
  errors: string[]
  readAt: number
}

export interface ModelInput {
  ws: string
  name: string
  status: StatusDoc
  drift: DriftDoc | null
  repos: ReposDoc | null
  registry: WorkspacesDoc | null
  fetchedAt: number | null
  readAt: number
  errors?: string[]
}

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null
}

export function buildModel(i: ModelInput): PanelModel {
  const f = i.status.forge ?? {}
  const remote = f.kind !== undefined && f.kind !== 'path'
  const freshness = !remote ? 'local' : f.fetched === true ? 'fetched' : 'cached'

  const byOwner = new Map<string, Record<string, number>>()
  for (const s of i.status.statuses) {
    const counts = byOwner.get(s.target) ?? {}
    counts[s.state] = (counts[s.state] ?? 0) + 1
    byOwner.set(s.target, counts)
  }
  const owners = [...byOwner.keys()].sort((a, b) => (a === 'services' ? 1 : b === 'services' ? -1 : a.localeCompare(b)))

  const driftRows = new Map((i.drift?.files ?? []).map((d) => [d.path, d]))
  const mine = i.registry?.workspaces.find((w) => w.path === i.ws)
  const key = mine?.forge?.key ?? null

  const warnings: string[] = []
  for (const w of [...i.status.warnings, ...(i.drift?.warnings ?? []), ...(i.repos?.warnings ?? [])]) {
    if (!warnings.includes(w)) warnings.push(w)
  }

  return {
    ws: i.ws,
    name: i.name,
    forge: {
      source: str(f.source),
      ref: str(f.ref),
      commit: str(f.commit),
      lockCommit: str(f.lockCommit),
      profile: str(i.drift?.profile),
      freshness,
      fetchedAt: remote ? i.fetchedAt : null,
    },
    outputs: owners.map((owner) => ({ owner, counts: byOwner.get(owner) as Record<string, number> })),
    pending: i.status.statuses.filter((s) => PENDING.includes(s.state)).map((s) => ({ path: s.path, state: s.state })),
    edited: i.status.statuses
      .filter((s) => s.state === 'drift')
      .map((s) => {
        const d = driftRows.get(s.path)
        return { path: s.path, state: s.state, promotable: d?.promotable === true, reason: d ? d.reason : null }
      }),
    apart: i.status.statuses.filter((s) => APART.includes(s.state)).map((s) => ({ path: s.path, state: s.state })),
    repos: (i.repos?.repos ?? []).map((r) => ({ name: r.name, path: r.path, state: r.state, reason: r.reason })),
    siblings:
      key === null
        ? []
        : (i.registry?.workspaces ?? [])
            .filter((w) => w.path !== i.ws && w.forge?.key === key)
            .map((w) => ({ name: w.name, path: w.path, status: w.status, forgeMoved: w.forgeMoved })),
    warnings,
    unset: i.status.unsetParams ?? [],
    refused: (i.status.unsetParams ?? []).length > 0,
    errors: i.errors ?? [],
    readAt: i.readAt,
  }
}

export type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger'

export function barFor(m: PanelModel | 'error' | null): { text: string; tone: Tone } {
  if (m === null) return { text: 'craftar', tone: 'neutral' }
  if (m === 'error') return { text: 'craftar: error', tone: 'danger' }
  if (m.refused) return { text: 'craftar: sync refused', tone: 'danger' }
  const pending = m.pending.length
  const edited = m.edited.length + m.apart.length
  if (pending > 0 && edited > 0) return { text: `Forge moved · ${pending} · edited · ${edited}`, tone: 'warning' }
  if (pending > 0) return { text: `Forge moved · ${pending}`, tone: 'accent' }
  if (edited > 0) return { text: `edited · ${edited}`, tone: 'warning' }
  return { text: 'craftar: in sync', tone: 'success' }
}
