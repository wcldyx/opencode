import { createSimpleContext } from "@opencode-ai/ui/context"
import { type Accessor, batch, createEffect, createMemo, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { usePlatform } from "@/context/platform"
import { Persist, persisted } from "@/utils/persist"
import { useCheckServerHealth } from "@/utils/server-health"
import { directoryKey } from "@/utils/directory"

type StoredProject = { worktree: string; expanded: boolean }
type StoredServer = string | ServerConnection.HttpBase | ServerConnection.Http
const HEALTH_POLL_INTERVAL_MS = 10_000

const dirKey = (dir: string) => directoryKey(dir)

function normalizeProjects(list: StoredProject[]) {
  const map = new Map<string, StoredProject>()

  for (const item of list) {
    const worktree = dirKey(item.worktree)
    const prev = map.get(worktree)
    if (!prev) {
      map.set(worktree, { ...item, worktree })
      continue
    }
    if (item.expanded && !prev.expanded) map.set(worktree, { ...prev, expanded: true })
  }

  return [...map.values()]
}

function migrate(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value

  const next = { ...(value as Record<string, unknown>) }
  let changed = false

  const projects = next.projects
  if (projects && typeof projects === "object" && !Array.isArray(projects)) {
    const out = Object.fromEntries(
      Object.entries(projects).map(([key, list]) => {
        if (!Array.isArray(list)) return [key, list]
        const items = list
          .filter(
            (item): item is StoredProject =>
              !!item && typeof item === "object" && typeof (item as StoredProject).worktree === "string",
          )
          .map((item) => ({ worktree: dirKey(item.worktree), expanded: !!item.expanded }))
        const normalized = normalizeProjects(items)
        if (
          normalized.length !== list.length ||
          normalized.some((item, idx) => item.worktree !== items[idx]?.worktree || item.expanded !== items[idx]?.expanded)
        ) {
          changed = true
        }
        return [key, normalized]
      }),
    )
    next.projects = out
  }

  const last = next.lastProject
  if (last && typeof last === "object" && !Array.isArray(last)) {
    const out = Object.fromEntries(
      Object.entries(last).map(([key, dir]) => {
        if (typeof dir !== "string") return [key, dir]
        const normalized = dirKey(dir)
        if (normalized !== dir) changed = true
        return [key, normalized]
      }),
    )
    next.lastProject = out
  }

  return changed ? next : value
}

export const ServerTesting = {
  dirKey,
  normalizeProjects,
  migrate,
}

export function normalizeServerUrl(input: string) {
  const trimmed = input.trim()
  if (!trimmed) return
  const withProtocol = /^https?:\/\//.test(trimmed) ? trimmed : `http://${trimmed}`
  return withProtocol.replace(/\/+$/, "")
}

export function serverName(conn?: ServerConnection.Any, ignoreDisplayName = false) {
  if (!conn) return ""
  if (conn.displayName && !ignoreDisplayName) return conn.displayName
  return conn.http.url.replace(/^https?:\/\//, "").replace(/\/+$/, "")
}

function projectsKey(key: ServerConnection.Key) {
  if (!key) return ""
  if (key === "sidecar") return "local"
  if (isLocalHost(key)) return "local"
  return key
}

function isLocalHost(url: string) {
  const host = url.replace(/^https?:\/\//, "").split(":")[0]
  if (host === "localhost" || host === "127.0.0.1") return "local"
}

export function resolveServerList(input: {
  props?: Array<ServerConnection.Any>
  stored: StoredServer[]
}): Array<ServerConnection.Any> {
  const servers = [
    ...input.stored.map((value) =>
      typeof value === "string"
        ? {
            type: "http" as const,
            http: { url: value },
          }
        : value,
    ),
    ...(input.props ?? []),
  ]

  const deduped = new Map<ServerConnection.Key, ServerConnection.Any>()
  for (const value of servers) {
    const conn: ServerConnection.Any = "type" in value ? value : { type: "http", http: value }
    const key = ServerConnection.key(conn)
    if (deduped.has(key) && conn.type === "http" && !conn.authToken) continue
    deduped.set(key, conn)
  }

  return [...deduped.values()]
}

export namespace ServerConnection {
  type Base = { displayName?: string }

  export type HttpBase = {
    url: string
    username?: string
    password?: string
  }

  // Regular web connections
  export type Http = {
    type: "http"
    http: HttpBase
    authToken?: boolean
  } & Base

  export type Sidecar = {
    type: "sidecar"
    http: HttpBase
  } & (
    | // Regular desktop server
    { variant: "base" }
    // WSL server (windows only)
    | {
        variant: "wsl"
        distro: string
      }
  ) &
    Base

  // Remote server desktop can SSH into
  export type Ssh = {
    type: "ssh"
    host: string
    // SSH client exposes an HTTP server for the app to use as a proxy
    http: HttpBase
  } & Base

  export type Any =
    | Http
    // All these are desktop-only
    | (Sidecar | Ssh)

  export const key = (conn: Any): Key => {
    switch (conn.type) {
      case "http":
        return Key.make(conn.http.url)
      case "sidecar": {
        if (conn.variant === "wsl") return Key.make(`wsl:${conn.distro}`)
        return Key.make("sidecar")
      }
      case "ssh":
        return Key.make(`ssh:${conn.host}`)
    }
  }

  export type Key = string & { _brand: "Key" }
  export const Key = { make: (v: string) => v as Key }
}

export const { use: useServer, provider: ServerProvider } = createSimpleContext({
  name: "Server",
  init: (props: {
    defaultServer: ServerConnection.Key
    disableHealthCheck?: boolean
    servers?: Array<ServerConnection.Any>
  }) => {
    const platform = usePlatform()
    const checkServerHealth = useCheckServerHealth()

    const [store, setStore, _, ready] = persisted(
      { ...Persist.global("server", ["server.v3"]), migrate },
      createStore({
        list: [] as StoredServer[],
        projects: {} as Record<string, StoredProject[]>,
        lastProject: {} as Record<string, string>,
        active: undefined as ServerConnection.Key | undefined,
      }),
    )

    const url = (x: StoredServer) => (typeof x === "string" ? x : "type" in x ? x.http.url : x.url)

    const allServers = createMemo((): Array<ServerConnection.Any> => {
      return resolveServerList({ stored: store.list, props: props.servers })
    })

    const [state, setState] = createStore({
      active: store.active ?? props.defaultServer,
      healthy: undefined as boolean | undefined,
    })

    const healthy = () => state.healthy

    function startHealthPolling(conn: ServerConnection.Any) {
      let alive = true
      let busy = false

      const run = () => {
        if (busy) return
        busy = true
        void check(conn)
          .then((next) => {
            if (!alive) return
            setState("healthy", next)
          })
          .finally(() => {
            busy = false
          })
      }

      run()
      const interval = setInterval(run, HEALTH_POLL_INTERVAL_MS)
      return () => {
        alive = false
        clearInterval(interval)
      }
    }

    function setActive(input: ServerConnection.Key) {
      if (state.active === input) return
      setState("active", input)
      setStore("active", input)
    }

    function add(input: ServerConnection.Http) {
      const url_ = normalizeServerUrl(input.http.url)
      if (!url_) return
      const conn: ServerConnection.Http = { ...input, authToken: undefined, http: { ...input.http, url: url_ } }
      return batch(() => {
        const existing = store.list.findIndex((x) => url(x) === url_)
        if (existing !== -1) {
          setStore("list", existing, conn)
        } else {
          setStore("list", store.list.length, conn)
        }
        const key = ServerConnection.key(conn)
        setState("active", key)
        setStore("active", key)
        return conn
      })
    }

    function remove(key: ServerConnection.Key) {
      const list = store.list.filter((x) => url(x) !== key)
      batch(() => {
        setStore("list", list)
        if (state.active === key) {
          const next = list[0]
          const target = next ? ServerConnection.Key.make(url(next)) : props.defaultServer
          setState("active", target)
          setStore("active", target)
        }
      })
    }

    const isReady = createMemo(() => ready() && !!state.active)

    const check = (conn: ServerConnection.Any) => checkServerHealth(conn.http).then((x) => x.healthy)

    createEffect(() => {
      const current_ = current()
      if (!current_) return

      if (props.disableHealthCheck) {
        setState("healthy", true)
        return
      }
      setState("healthy", undefined)
      onCleanup(startHealthPolling(current_))
    })

    const origin = createMemo(() => projectsKey(state.active))
    const projectsList = createMemo(() => normalizeProjects(store.projects[origin()] ?? []))
    const current: Accessor<ServerConnection.Any | undefined> = createMemo(
      () => allServers().find((s) => ServerConnection.key(s) === state.active) ?? allServers()[0],
    )

    createEffect(() => {
      if (!ready()) return
      if (store.active && state.active !== store.active) {
        if (allServers().some((server) => ServerConnection.key(server) === store.active)) {
          setState("active", store.active)
          return
        }
      }

      const conn = current()
      if (!conn) return
      const key = ServerConnection.key(conn)
      if (state.active !== key) setState("active", key)
      if (store.active !== key) setStore("active", key)
    })
    const isLocal = createMemo(() => {
      const c = current()
      return (c?.type === "sidecar" && c.variant === "base") || (c?.type === "http" && isLocalHost(c.http.url))
    })

    createEffect(() => {
      if (!ready()) return
      const conn = current()
      if (!conn || conn.type !== "http") return
      void platform.configureTracker?.({
        url: conn.http.url,
        username: conn.http.username,
        password: conn.http.password,
      })
    })

    return {
      ready: isReady,
      healthy,
      isLocal,
      get key() {
        return state.active
      },
      get name() {
        return serverName(current())
      },
      get list() {
        return allServers()
      },
      get current() {
        return current()
      },
      setActive,
      add,
      remove,
      projects: {
        list: projectsList,
        open(directory: string) {
          const key = origin()
          if (!key) return
          const worktree = dirKey(directory)
          const current = normalizeProjects(store.projects[key] ?? [])
          if (current.some((x) => x.worktree === worktree)) return
          setStore("projects", key, [{ worktree, expanded: true }, ...current])
        },
        close(directory: string) {
          const key = origin()
          if (!key) return
          const worktree = dirKey(directory)
          const current = normalizeProjects(store.projects[key] ?? [])
          setStore(
            "projects",
            key,
            current.filter((x) => x.worktree !== worktree),
          )
        },
        expand(directory: string) {
          const key = origin()
          if (!key) return
          const worktree = dirKey(directory)
          const current = normalizeProjects(store.projects[key] ?? [])
          const index = current.findIndex((x) => x.worktree === worktree)
          if (index === -1) return
          setStore("projects", key, current.map((item, idx) => (idx === index ? { ...item, expanded: true } : item)))
        },
        collapse(directory: string) {
          const key = origin()
          if (!key) return
          const worktree = dirKey(directory)
          const current = normalizeProjects(store.projects[key] ?? [])
          const index = current.findIndex((x) => x.worktree === worktree)
          if (index === -1) return
          setStore("projects", key, current.map((item, idx) => (idx === index ? { ...item, expanded: false } : item)))
        },
        move(directory: string, toIndex: number) {
          const key = origin()
          if (!key) return
          const worktree = dirKey(directory)
          const current = normalizeProjects(store.projects[key] ?? [])
          const fromIndex = current.findIndex((x) => x.worktree === worktree)
          if (fromIndex === -1 || fromIndex === toIndex) return
          const result = [...current]
          const [item] = result.splice(fromIndex, 1)
          result.splice(toIndex, 0, item)
          setStore("projects", key, result)
        },
        last() {
          const key = origin()
          if (!key) return
          const dir = store.lastProject[key]
          return typeof dir === "string" ? dirKey(dir) : dir
        },
        touch(directory: string) {
          const key = origin()
          if (!key) return
          setStore("lastProject", key, dirKey(directory))
        },
      },
    }
  },
})
