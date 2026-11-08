// When craftar runs (spec 60 §2.4, §7.1). The status bar item is what keeps the worker alive (pending
// the S0 probe: README, "Pending the S0 probe"); the timer only schedules reads. One run at a time per
// workspace: a second run waits for the first, whatever its outcome. Only the periodic read may fetch,
// and only with the fetch setting on; a focus change never reaches the network.
import { type Craftar, status, type StatusDoc } from './craftar'

const MIN_MINUTES = 2
const DEFAULT_MINUTES = 2

export class Serial {
  private tails = new Map<string, Promise<unknown>>()

  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve()
    const next = prev.then(fn, fn)
    const tail = next.catch(() => undefined)
    this.tails.set(key, tail)
    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key)
    })
    return next
  }
}

export function intervalMs(minutes: unknown): number {
  const n = typeof minutes === 'number' && Number.isFinite(minutes) ? Math.floor(minutes) : DEFAULT_MINUTES
  return Math.max(MIN_MINUTES, n) * 60_000
}

export type Reason = 'periodic' | 'focus'

export function readStatus(c: Craftar, ws: string, reason: Reason, settings: { fetch: boolean }): Promise<StatusDoc> {
  return status(c, ws, { fetch: reason === 'periodic' && settings.fetch === true })
}
