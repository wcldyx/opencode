export const normalizeDirectory = (directory: string) => {
  const value = directory.replaceAll("\\", "/")
  const drive = value.match(/^([A-Za-z]:)\/+$/)
  if (drive) return `${drive[1].toUpperCase()}/`
  if (/^\/+$/i.test(value)) return "/"

  const next = value.replace(/\/+$/, "")
  const path = next.match(/^([A-Za-z]):(\/.*)?$/)
  if (path) return `${path[1].toUpperCase()}:${path[2] ?? ""}`
  return next
}

type State =
  | {
      status: "pending"
    }
  | {
      status: "ready"
    }
  | {
      status: "failed"
      message: string
    }

const state = new Map<string, State>()
const waiters = new Map<
  string,
  {
    promise: Promise<State>
    resolve: (state: State) => void
  }
>()

function deferred() {
  const box = { resolve: (_: State) => {} }
  const promise = new Promise<State>((resolve) => {
    box.resolve = resolve
  })
  return { promise, resolve: box.resolve }
}

export const Worktree = {
  get(directory: string) {
    return state.get(normalizeDirectory(directory))
  },
  pending(directory: string) {
    const key = normalizeDirectory(directory)
    const current = state.get(key)
    if (current && current.status !== "pending") return
    state.set(key, { status: "pending" })
  },
  ready(directory: string) {
    const key = normalizeDirectory(directory)
    const next = { status: "ready" } as const
    state.set(key, next)
    const waiter = waiters.get(key)
    if (!waiter) return
    waiters.delete(key)
    waiter.resolve(next)
  },
  failed(directory: string, message: string) {
    const key = normalizeDirectory(directory)
    const next = { status: "failed", message } as const
    state.set(key, next)
    const waiter = waiters.get(key)
    if (!waiter) return
    waiters.delete(key)
    waiter.resolve(next)
  },
  wait(directory: string) {
    const key = normalizeDirectory(directory)
    const current = state.get(key)
    if (current && current.status !== "pending") return Promise.resolve(current)

    const existing = waiters.get(key)
    if (existing) return existing.promise

    const waiter = deferred()

    waiters.set(key, waiter)
    return waiter.promise
  },
}
