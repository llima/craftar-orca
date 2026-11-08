// A minimal document for testing the panel's drawing in Node: elements with attributes, children, text
// and click listeners. It has no innerHTML on purpose — the panel never inserts markup.
export interface FakeEl {
  tag: string
  ns: string | null
  attrs: Record<string, string>
  children: FakeEl[]
  text: string | null
  listeners: Record<string, (() => void)[]>
  setAttribute(k: string, v: string): void
  getAttribute(k: string): string | null
  appendChild<T extends FakeEl>(c: T): T
  replaceChildren(...c: FakeEl[]): void
  addEventListener(ev: string, fn: () => void): void
  textContent: string
  /** An input's value, as a person would type it. */
  value: string
}

function el(tag: string, ns: string | null): FakeEl {
  const e: FakeEl = {
    tag,
    ns,
    attrs: {},
    children: [],
    text: null,
    value: '',
    listeners: {},
    setAttribute(k, v) {
      e.attrs[k] = String(v)
    },
    getAttribute(k) {
      return k in e.attrs ? e.attrs[k] : null
    },
    appendChild(c) {
      e.children.push(c)
      return c
    },
    replaceChildren(...c) {
      e.children = c
      e.text = null
    },
    addEventListener(ev, fn) {
      ;(e.listeners[ev] ??= []).push(fn)
    },
    get textContent(): string {
      return e.text ?? e.children.map((c) => c.textContent).join('')
    },
    set textContent(v: string) {
      e.children = []
      e.text = String(v)
    },
  }
  return e
}

export function fakeDocument() {
  return {
    createElement: (tag: string) => el(tag, null),
    createElementNS: (ns: string, tag: string) => el(tag, ns),
  }
}

export function all(root: FakeEl): FakeEl[] {
  return [root, ...root.children.flatMap(all)]
}

export function byAction(root: FakeEl, action: string): FakeEl[] {
  return all(root).filter((e) => e.attrs['data-action'] === action)
}

export function click(e: FakeEl): void {
  for (const fn of e.listeners.click ?? []) fn()
}
