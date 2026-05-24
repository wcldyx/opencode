import type {
  Config,
  Message,
  OpencodeClient,
  Part,
  Path,
  Project,
  ProviderAuthResponse,
  Todo,
} from "@opencode-ai/sdk/v2/client"
import { showToast } from "@opencode-ai/ui/toast"
import { makeEventListener } from "@solid-primitives/event-listener"
import { getFilename } from "@opencode-ai/core/util/path"
import { batch, createContext, getOwner, onCleanup, onMount, type ParentProps, untrack, useContext } from "solid-js"
import { createStore, produce, reconcile } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { sameDirectory, toServerDirectory } from "@/utils/directory"
import type { InitError } from "../pages/error"
import { useGlobalSDK } from "./global-sdk"
import {
  bootstrapDirectory,
  bootstrapGlobal,
  clearProviderRev,
  loadAgentsQuery,
  loadGlobalConfigQuery,
  loadPathQuery,
  loadProjectsQuery,
  loadProvidersQuery,
} from "./global-sync/bootstrap"
import { createChildStoreManager } from "./global-sync/child-store"
import { applyDirectoryEvent, applyGlobalEvent, cleanupDroppedSessionCaches } from "./global-sync/event-reducer"
import { clearSessionPrefetchDirectory } from "./global-sync/session-prefetch"
import { estimateRootSessionTotal, loadRootSessionsWithFallback } from "./global-sync/session-load"
import { trimSessions } from "./global-sync/session-trim"
import type { ProjectMeta } from "./global-sync/types"
import { SESSION_RECENT_LIMIT } from "./global-sync/types"
import { formatServerError } from "@/utils/server-errors"
import { queryOptions, useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/solid-query"
import { createRefreshQueue } from "./global-sync/queue"
import { directoryKey } from "./global-sync/utils"
import { PathKey } from "@/utils/path-key"
import { createDirSyncContext } from "./directory-sync"
import { NormalizedProviderListResponse } from "@opencode-ai/ui/context"

type GlobalStore = {
  ready: boolean
  error?: InitError
  path: Path
  project: Project[]
  session_todo: {
    [sessionID: string]: Todo[]
  }
  provider: NormalizedProviderListResponse
  provider_auth: ProviderAuthResponse
  config: Config
  reload: undefined | "pending" | "complete"
}

export const loadMcpQuery = (directory: string, sdk: OpencodeClient) =>
  queryOptions({
    queryKey: [directory, "mcp"] as const,
    queryFn: () => sdk.mcp.status().then((r) => r.data ?? {}),
  })

export const loadLspQuery = (directory: string, sdk: OpencodeClient) =>
  queryOptions({
    queryKey: [directory, "lsp"] as const,
    queryFn: () => sdk.lsp.status().then((r) => r.data ?? []),
  })

function makeQueryOptionsApi(globalSDK: () => OpencodeClient, sdkFor: (dir: PathKey) => OpencodeClient) {
  return {
    globalConfig: () => loadGlobalConfigQuery(globalSDK()),
    projects: () => loadProjectsQuery(globalSDK()),
    providers: (directory: PathKey | null) =>
      loadProvidersQuery(directory, directory === null ? globalSDK() : sdkFor(directory)),
    path: (directory: PathKey | null) => loadPathQuery(directory, directory === null ? globalSDK() : sdkFor(directory)),
    agents: (directory: PathKey) => loadAgentsQuery(directory, sdkFor(directory)),
    mcp: (directory: PathKey) => loadMcpQuery(directory, sdkFor(directory)),
    lsp: (directory: PathKey) => loadLspQuery(directory, sdkFor(directory)),
    sessions: (directory: PathKey) => ({ queryKey: [directory, "loadSessions"] as const }),
  }
}
export type QueryOptionsApi = ReturnType<typeof makeQueryOptionsApi>

function createGlobalSync() {
  const globalSDK = useGlobalSDK()
  const language = useLanguage()
  const owner = getOwner()
  if (!owner) throw new Error("GlobalSync must be created within owner")

  const sdkCache = new Map<string, OpencodeClient>()
  const booting = new Map<string, Promise<void>>()
  const sessionLoads = new Map<string, Promise<void>>()
  const sessionMeta = new Map<string, { limit: number; path: string }>()

  const sdkFor = (directory: string) => {
    const key = directoryKey(directory)
    const cached = sdkCache.get(key)
    if (cached) return cached
    const sdk = globalSDK.createClient({
      directory,
      throwOnError: true,
    })
    sdkCache.set(key, sdk)
    return sdk
  }

  const queryOptionsApi = makeQueryOptionsApi(() => globalSDK.client, sdkFor)

  const [configQuery, providerQuery, pathQuery] = useQueries(() => ({
    queries: [queryOptionsApi.globalConfig(), queryOptionsApi.providers(null), queryOptionsApi.path(null)],
  }))

  const [globalStore, setGlobalStore] = createStore<GlobalStore>({
    get ready() {
      return bootstrap.isPending
    },
    project: [],
    session_todo: {},
    provider_auth: {},
    get path() {
      const EMPTY = { state: "", config: "", worktree: "", directory: "", home: "" }
      if (pathQuery.isLoading) return EMPTY
      return pathQuery.data ?? EMPTY
    },
    get provider() {
      const EMPTY = { all: new Map(), connected: [], default: {} }
      if (providerQuery.isLoading) return EMPTY
      return providerQuery.data ?? EMPTY
    },
    get config() {
      if (configQuery.isLoading) return {}
      return configQuery.data ?? {}
    },
    get reload() {
      return updateConfigMutation.isPending ? "pending" : undefined
    },
  })
  const queryClient = useQueryClient()

  let bootedAt = 0
  let bootingRoot = false
  let eventFrame: number | undefined
  let eventTimer: ReturnType<typeof setTimeout> | undefined
  let tick: ReturnType<typeof setInterval> | undefined
  let stop: ReturnType<typeof setTimeout> | undefined
  let round = 0

  onCleanup(() => {
    if (eventFrame !== undefined) cancelAnimationFrame(eventFrame)
    if (eventTimer !== undefined) clearTimeout(eventTimer)
    if (tick !== undefined) clearInterval(tick)
    if (stop !== undefined) clearTimeout(stop)
  })

  const setProjects = (next: Project[] | ((draft: Project[]) => Project[])) => {
    setGlobalStore("project", next)
  }

  const setBootStore = ((...input: unknown[]) => {
    if (input[0] === "project" && Array.isArray(input[1])) {
      setProjects(input[1] as Project[])
      return input[1]
    }
    return (setGlobalStore as (...args: unknown[]) => unknown)(...input)
  }) as typeof setGlobalStore

  const bootstrap = useQuery(() => ({
    queryKey: ["bootstrap"],
    queryFn: async () => {
      await bootstrapGlobal({
        globalSDK: globalSDK.client,
        requestFailedTitle: language.t("common.requestFailed"),
        translate: language.t,
        formatMoreCount: (count) => language.t("common.moreCountSuffix", { count }),
        setGlobalStore: setBootStore,
        queryClient,
      })
      bootedAt = Date.now()
      return bootedAt
    },
  }))

  const set = ((...input: unknown[]) => {
    if (input[0] === "project" && (Array.isArray(input[1]) || typeof input[1] === "function")) {
      setProjects(input[1] as Project[] | ((draft: Project[]) => Project[]))
      return input[1]
    }
    return (setGlobalStore as (...args: unknown[]) => unknown)(...input)
  }) as typeof setGlobalStore

  const setSessionTodo = (sessionID: string, todos: Todo[] | undefined) => {
    if (!sessionID) return
    if (!todos) {
      setGlobalStore(
        "session_todo",
        produce((draft) => {
          delete draft[sessionID]
        }),
      )
      return
    }
    setGlobalStore("session_todo", sessionID, reconcile(todos, { key: "id" }))
  }

  const paused = () => untrack(() => globalStore.reload) !== undefined

  const queue = createRefreshQueue({
    paused,
    key: directoryKey,
    bootstrap: () => queryClient.fetchQuery({ queryKey: ["bootstrap"] }),
    bootstrapInstance,
  })

  const children = createChildStoreManager({
    owner,
    isBooting: (directory) => booting.has(directory),
    isLoadingSessions: (directory) => sessionLoads.has(directory),
    onBootstrap: (directory) => {
      void bootstrapInstance(directory)
    },
    onDispose: (directory) => {
      const key = directoryKey(directory)
      queue.clear(key)
      sessionMeta.delete(key)
      sdkCache.delete(key)
      clearProviderRev(key)
      clearSessionPrefetchDirectory(key)
    },
    translate: language.t,
    queryOptions: queryOptionsApi,
    global: {
      provider: globalStore.provider,
    },
  })

  async function loadSessions(directory: string) {
    const dir = directoryKey(directory)
    const pending = sessionLoads.get(dir)
    if (pending) return pending

    children.pin(dir)
    const [store, setStore] = children.child(dir, { bootstrap: false })
    const path = store.path.directory
    const target = toServerDirectory(path && sameDirectory(path, dir) ? path : path || dir)
    const meta = sessionMeta.get(dir)
    if (meta && meta.limit >= store.limit && meta.path === target) {
      const next = trimSessions(store.session, {
        limit: store.limit,
        permission: store.permission,
      })
      if (next.length !== store.session.length) {
        setStore("session", reconcile(next, { key: "id" }))
        cleanupDroppedSessionCaches(store, setStore, next, setSessionTodo)
      }
      children.unpin(dir)
      return
    }

    const limit = Math.max(store.limit + SESSION_RECENT_LIMIT, SESSION_RECENT_LIMIT)
    const promise = queryClient
      .fetchQuery({
        ...queryOptionsApi.sessions(dir),
        queryFn: () =>
          loadRootSessionsWithFallback({
            directory: target,
            limit,
            list: (query) => globalSDK.client.session.list(query),
          })
            .then((x) => {
              const nonArchived = (x.data ?? [])
                .filter((s) => !!s?.id)
                .filter((s) => !s.time?.archived)
                .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
              const limit = store.limit
              const childSessions = store.session.filter((s) => !!s.parentID)
              const sessions = trimSessions([...nonArchived, ...childSessions], {
                limit,
                permission: store.permission,
              })
              batch(() => {
                setStore(
                  "sessionTotal",
                  estimateRootSessionTotal({
                    count: nonArchived.length,
                    limit: x.limit,
                    limited: x.limited,
                  }),
                )
                setStore("session", reconcile(sessions, { key: "id" }))
                cleanupDroppedSessionCaches(store, setStore, sessions, setSessionTodo)
              })
              sessionMeta.set(dir, { limit, path: target })
            })
            .catch((err) => {
              console.error("Failed to load sessions", err)
              const project = getFilename(target)
              showToast({
                variant: "error",
                title: language.t("toast.session.listFailed.title", { project }),
                description: formatServerError(err, language.t),
              })
            })
            .then(() => null),
      })
      .then(() => {})

    sessionLoads.set(dir, promise)
    void promise.finally(() => {
      sessionLoads.delete(dir)
      children.unpin(dir)
    })
    return promise
  }

  async function bootstrapInstance(directory: string) {
    const key = directoryKey(directory)
    if (!key) return
    const pending = booting.get(key)
    if (pending) return pending

    children.pin(key)
    const promise = Promise.resolve().then(async () => {
      const child = children.ensureChild(directory)
      const cache = children.vcsCache.get(key)
      if (!cache) return
      const sdk = sdkFor(directory)
      await bootstrapDirectory({
        directory,
        global: {
          config: globalStore.config,
          path: globalStore.path,
          project: globalStore.project,
          provider: globalStore.provider,
        },
        sdk,
        store: child[0],
        setStore: child[1],
        vcsCache: cache,
        loadSessions,
        translate: language.t,
        queryClient,
      })
    })

    booting.set(key, promise)
    void promise.finally(() => {
      booting.delete(key)
      children.unpin(key)
    })
    return promise
  }

  const clear = () => {
    if (tick !== undefined) {
      clearInterval(tick)
      tick = undefined
    }
    if (stop !== undefined) {
      clearTimeout(stop)
      stop = undefined
    }
  }

  const reconcilePending = async (dir: string, setStore: (typeof children.children)[string][1], ids: string[]) => {
    const rows = await Promise.all(
      ids.map((sessionID) =>
        sdkFor(dir)
          .session.messages({ sessionID, limit: 50 })
          .then((x) => {
            const items = (x.data ?? []).filter((v) => !!v?.info?.id)
            const msgs = items.map((v) => v.info as Message).sort((a, b) => a.id.localeCompare(b.id))
            const parts = items.map((v) => ({
              id: v.info.id,
              part: [...v.parts].sort((a, b) => a.id.localeCompare(b.id)) as Part[],
            }))

            setStore("message", sessionID, reconcile(msgs, { key: "id" }))
            for (const item of parts) {
              setStore("part", item.id, reconcile(item.part, { key: "id" }))
            }

            const busy = msgs.some((m) => m.role === "assistant" && typeof m.time.completed !== "number")
            if (!busy) setStore("session_status", sessionID, { type: "idle" })
            return busy
          })
          .catch(() => true),
      ),
    )

    return rows.some(Boolean)
  }

  const settle = () => {
    const run = ++round

    const once = async () => {
      const dirs = Object.keys(children.children)
      if (dirs.length === 0) {
        clear()
        return
      }

      const rows = await Promise.all(
        dirs.map(async (dir) => {
          const child = children.children[dir]
          if (!child) return false
          const [store, setStore] = child
          const pending = Object.entries(store.message)
            .filter(([, msgs]) =>
              (msgs ?? []).some((m) => m.role === "assistant" && typeof m.time.completed !== "number"),
            )
            .map(([sessionID]) => sessionID)

          const hot = Object.values(store.session_status).some((x) => x && x.type !== "idle")
          if (!hot && pending.length === 0) return false

          const running = await sdkFor(dir)
            .session.status()
            .then((x) => {
              const next = x.data ?? {}
              setStore("session_status", next)
              return Object.values(next).some((v) => v && v.type !== "idle")
            })
            .catch(() => hot)

          if (running || pending.length === 0) return running
          return reconcilePending(dir, setStore, pending)
        }),
      )

      if (run !== round) return
      if (rows.some(Boolean)) return
      clear()
    }

    void once()
    if (tick !== undefined) return
    tick = setInterval(() => {
      void once()
    }, 1000)
    stop = setTimeout(() => {
      clear()
    }, 30_000)
  }

  const unsub = globalSDK.event.listen((e) => {
    const directory = e.name === "global" ? "global" : directoryKey(e.name)
    const key = directoryKey(directory)
    const event = e.details
    const recent = bootingRoot || Date.now() - bootedAt < 1500

    if (directory === "global") {
      applyGlobalEvent({
        event,
        project: globalStore.project,
        refresh: () => {
          if (recent) return
          bootstrap.refetch()
        },
        setGlobalProject: setProjects,
      })
      if (event.type === "server.connected" || event.type === "global.disposed") {
        if (recent) return
        for (const directory of Object.keys(children.children)) {
          queue.push(directory)
        }
      }
      return
    }

    const existing = children.children[key]
    if (!existing) return
    children.mark(key)
    const [store, setStore] = existing
    applyDirectoryEvent({
      event,
      directory,
      store,
      setStore,
      push: queue.push,
      setSessionTodo,
      vcsCache: children.vcsCache.get(key),
      loadLsp: () => {
        void queryClient.fetchQuery(queryOptionsApi.lsp(key))
      },
    })
  })

  onCleanup(unsub)
  onCleanup(() => {
    queue.dispose()
  })
  onCleanup(() => {
    for (const directory of Object.keys(children.children)) {
      children.disposeDirectory(directoryKey(directory))
    }
  })

  onMount(() => {
    if (typeof requestAnimationFrame === "function") {
      eventFrame = requestAnimationFrame(() => {
        eventFrame = undefined
        eventTimer = setTimeout(() => {
          eventTimer = undefined
          void globalSDK.event.start()
        }, 0)
      })
    } else {
      eventTimer = setTimeout(() => {
        eventTimer = undefined
        void globalSDK.event.start()
      }, 0)
    }

    const sync = () => {
      queue.refresh()
      for (const directory of Object.keys(children.children)) {
        queue.push(directory)
      }
      settle()
    }

    makeEventListener(document, "visibilitychange", () => {
      if (document.visibilityState !== "visible") return
      sync()
    })
    makeEventListener(window, "focus", sync)
    makeEventListener(window, "opencode:resume", sync as EventListener)
  })

  const projectApi = {
    loadSessions,
    meta(directory: string, patch: ProjectMeta) {
      children.projectMeta(directory, patch)
    },
    icon(directory: string, value: string | undefined) {
      children.projectIcon(directory, value)
    },
  }

  const updateConfigMutation = useMutation(() => ({
    mutationFn: (config: Config) => globalSDK.client.global.config.update({ config }),
    onSuccess: () => {
      bootstrap.refetch()
      // Invalidate all provider queries so newly configured custom providers
      // appear immediately in the available provider list across all directories.
      queryClient.invalidateQueries({ queryKey: [null, "providers"] })
      queryClient.invalidateQueries({ predicate: (query) => query.queryKey[1] === "providers" })
    },
  }))

  const dirSyncContexts = new Map<string, ReturnType<typeof createDirSyncContext>>()
  const dirSyncContextRefCounts = new Map<string, number>()

  return {
    data: globalStore,
    set,
    get ready() {
      return globalStore.ready
    },
    get error() {
      return globalStore.error
    },
    child: children.child,
    peek: children.peek,
    queryOptions: queryOptionsApi,
    // bootstrap,
    updateConfig: updateConfigMutation.mutateAsync,
    project: projectApi,
    todo: {
      set: setSessionTodo,
    },
    createDirSyncContext: (directory: string) => {
      onCleanup(() => {
        dirSyncContextRefCounts.set(directory, (dirSyncContextRefCounts.get(directory) ?? 0) - 1)
        if (dirSyncContextRefCounts.get(directory) === 0) {
          dirSyncContexts.delete(directory)
          dirSyncContextRefCounts.delete(directory)
        }
      })

      const cached = dirSyncContexts.get(directory)
      if (cached) {
        dirSyncContextRefCounts.set(directory, (dirSyncContextRefCounts.get(directory) ?? 0) + 1)
        return cached
      }
      const ctx = createDirSyncContext(globalSDK.createClient({ directory, throwOnError: true }), directory)
      dirSyncContexts.set(directory, ctx)
      dirSyncContextRefCounts.set(directory, 1)

      return ctx
    },
  }
}

const GlobalSyncContext = createContext<ReturnType<typeof createGlobalSync>>()

export function GlobalSyncProvider(props: ParentProps) {
  const value = createGlobalSync()
  return <GlobalSyncContext.Provider value={value}>{props.children}</GlobalSyncContext.Provider>
}

export function useGlobalSync() {
  const context = useContext(GlobalSyncContext)
  if (!context) throw new Error("useGlobalSync must be used within GlobalSyncProvider")
  return context
}

export function useQueryOptions() {
  return useGlobalSync().queryOptions
}
