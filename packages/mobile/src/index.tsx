// @refresh reload

import { createEffect } from "solid-js"
import { render } from "solid-js/web"
import { AppBaseProviders, AppInterface, PlatformProvider, ServerConnection, type Platform } from "@opencode-ai/app"
import { useSettings } from "../../app/src/context/settings"
import pkg from "../package.json"
import { Capacitor } from "@capacitor/core"
import { nativeKeepalive } from "./bridge-native"
import {
  hasRemoteServer,
  protectServerState,
  readStoredServer,
  serverBackupKey,
  serverStoreKey,
  serverStoreName,
  serverUrl,
} from "./server-storage"
import {
  backgroundStatus,
  back,
  bindBack,
  bindLifecycle,
  consumeLaunchHref,
  configureTracker,
  ensureNotifications,
  nativeFetch,
  notify,
  notifyTaskDone,
  openNotificationSettings,
  openLink,
  openPowerSettings,
  pulse,
  setTrackerNotify,
  setTrackerSound,
  trackSession,
  untrackSession,
} from "./bridge"
import { handleNotificationClick } from "@opencode-ai/app"

const root = document.getElementById("root")
if (!(root instanceof HTMLElement)) throw new Error("root not found")

const serverKey = "opencode.settings.dat:defaultServerUrl"
const serverStateKey = "opencode.global.dat:server"
type NativeStorage = {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
  removeItem(key: string): Promise<void>
}
const read = () => {
  if (typeof localStorage === "undefined") return null
  try {
    return localStorage.getItem(serverKey)
  } catch {
    return null
  }
}

const write = (value: string | null) => {
  if (typeof localStorage === "undefined") return
  try {
    if (value !== null) {
      localStorage.setItem(serverKey, value)
      return
    }
    localStorage.removeItem(serverKey)
  } catch {
    return
  }
}

const writeNativeDefault = async (value: string | null) => {
  if (!Capacitor.isNativePlatform()) return
  if (value !== null) {
    await nativeKeepalive.storageSet({ name: "opencode.settings.dat", key: "defaultServerUrl", value }).catch(
      () => undefined,
    )
    return
  }
  await nativeKeepalive.storageRemove({ name: "opencode.settings.dat", key: "defaultServerUrl" }).catch(() => undefined)
}

const storageName = (name?: string) => name ?? "default.dat"
const storageKey = (name: string | undefined, key: string) => `${storageName(name)}:${key}`
const isServerStorage = (name: string | undefined, key: string) => storageName(name) === serverStoreName && key === serverStoreKey
const readLocal = (key: string) => {
  if (typeof localStorage === "undefined") return null
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
const writeLocal = (key: string, value: string) => {
  if (typeof localStorage === "undefined") return
  try {
    localStorage.setItem(key, value)
  } catch {
    return
  }
}
const removeLocal = (key: string) => {
  if (typeof localStorage === "undefined") return
  try {
    localStorage.removeItem(key)
  } catch {
    return
  }
}
const recoveredServerState = async () => {
  const config = await nativeKeepalive.config().catch(() => ({ url: undefined, username: undefined, password: undefined }))
  const stored = await nativeKeepalive.storageGet({ name: "opencode.settings.dat", key: "defaultServerUrl" }).catch(
    () => ({ value: undefined }),
  )
  const url =
    typeof config.url === "string" && config.url
      ? config.url
      : typeof stored.value === "string" && stored.value
        ? stored.value
        : undefined
  if (!url) return null
  const conn: { type: "http"; http: { url: string; username?: string; password?: string } } = {
    type: "http",
    http: { url },
  }
  if (typeof config.username === "string" && config.username) conn.http.username = config.username
  if (typeof config.password === "string" && config.password) conn.http.password = config.password
  return JSON.stringify({ list: [conn], projects: {}, lastProject: {}, active: url })
}
const nativeStorage = (name?: string): NativeStorage => ({
  getItem: async (key) => {
    const item = await nativeKeepalive.storageGet({ name: storageName(name), key }).catch(() => ({ value: undefined }))
    if (typeof item.value === "string") {
      if (isServerStorage(name, key) && !hasRemoteServer(item.value)) {
        const backup = await nativeKeepalive.storageGet({ name: serverStoreName, key: serverBackupKey }).catch(() => ({
          value: undefined,
        }))
        if (typeof backup.value === "string" && hasRemoteServer(backup.value)) return backup.value
      }
      writeLocal(storageKey(name, key), item.value)
      return item.value
    }
    const local = readLocal(storageKey(name, key))
    if (local !== null) {
      await nativeKeepalive.storageSet({ name: storageName(name), key, value: local }).catch(() => undefined)
      return local
    }
    if (!isServerStorage(name, key)) return null
    const backup = await nativeKeepalive.storageGet({ name: serverStoreName, key: serverBackupKey }).catch(() => ({
      value: undefined,
    }))
    if (typeof backup.value === "string" && hasRemoteServer(backup.value)) return backup.value
    const recovered = await recoveredServerState()
    if (!recovered) return null
    await nativeKeepalive.storageSet({ name: storageName(name), key, value: recovered }).catch(() => undefined)
    writeLocal(storageKey(name, key), recovered)
    return recovered
  },
  setItem: async (key, value) => {
    const next = isServerStorage(name, key)
      ? await protectServerState({
          next: value,
          current: async () =>
            (await nativeKeepalive.storageGet({ name: serverStoreName, key: serverStoreKey }).catch(() => ({
              value: undefined,
            }))).value,
          backup: async () =>
            (await nativeKeepalive.storageGet({ name: serverStoreName, key: serverBackupKey }).catch(() => ({
              value: undefined,
            }))).value,
          local: () => readLocal(storageKey(serverStoreName, serverStoreKey)),
          recovered: recoveredServerState,
        })
      : value
    await nativeKeepalive.storageSet({ name: storageName(name), key, value: next })
    if (isServerStorage(name, key) && hasRemoteServer(next)) {
      await nativeKeepalive.storageSet({ name: serverStoreName, key: serverBackupKey, value: next }).catch(
        () => undefined,
      )
    }
    writeLocal(storageKey(name, key), next)
  },
  removeItem: async (key) => {
    if (isServerStorage(name, key)) {
      const next = await protectServerState({
        next: JSON.stringify({ list: [], projects: {}, lastProject: {} }),
        current: async () =>
          (await nativeKeepalive.storageGet({ name: serverStoreName, key: serverStoreKey }).catch(() => ({
            value: undefined,
          }))).value,
        backup: async () =>
          (await nativeKeepalive.storageGet({ name: serverStoreName, key: serverBackupKey }).catch(() => ({
            value: undefined,
          }))).value,
        local: () => readLocal(storageKey(serverStoreName, serverStoreKey)),
        recovered: recoveredServerState,
      })
      if (hasRemoteServer(next)) {
        await nativeKeepalive.storageSet({ name: serverStoreName, key: serverStoreKey, value: next })
        await nativeKeepalive.storageSet({ name: serverStoreName, key: serverBackupKey, value: next }).catch(
          () => undefined,
        )
        writeLocal(storageKey(name, key), next)
        return
      }
    }
    await nativeKeepalive.storageRemove({ name: storageName(name), key })
    removeLocal(storageKey(name, key))
  },
})

const readActiveServer = () => {
  if (typeof localStorage === "undefined") return null
  try {
    const raw = localStorage.getItem(serverStateKey)
    if (!raw) return null
    const state = JSON.parse(raw) as { active?: unknown; list?: unknown }
    const active = typeof state.active === "string" && /^https?:\/\//.test(state.active) ? state.active : undefined
    if (!active) return null
    const list = Array.isArray(state.list) ? state.list : []
    return list.map(serverUrl).find((item) => item === active) ?? active
  } catch {
    return null
  }
}

const readNative = async () => {
  if (!Capacitor.isNativePlatform()) return null
  const serverState = await nativeKeepalive.storageGet({ name: serverStoreName, key: serverStoreKey }).catch(() => ({
    value: undefined,
  }))
  const backup = await nativeKeepalive.storageGet({ name: serverStoreName, key: serverBackupKey }).catch(() => ({
    value: undefined,
  }))
  if (!hasRemoteServer(serverState.value) && hasRemoteServer(backup.value)) {
    await nativeKeepalive.storageSet({ name: serverStoreName, key: serverStoreKey, value: backup.value! }).catch(
      () => undefined,
    )
  }

  const stored = readStoredServer(hasRemoteServer(serverState.value) ? serverState.value : backup.value)
  if (stored) return stored

  const backupStored = readStoredServer(backup.value)
  if (backupStored) return backupStored

  const defaultUrl = await nativeKeepalive.storageGet({ name: "opencode.settings.dat", key: "defaultServerUrl" }).catch(
    () => ({ value: undefined }),
  )
  if (typeof defaultUrl.value === "string" && defaultUrl.value) return defaultUrl.value

  const config = await nativeKeepalive.config().catch(() => ({ url: undefined }))
  return typeof config.url === "string" && config.url ? config.url : null
}

const initialUrl = async () => (await readNative()) ?? read() ?? readActiveServer() ?? import.meta.env.VITE_OPENCODE_SERVER_URL ?? "http://localhost:4096"
const key = "opencode.mobile.bg-hint.v1"
const gap = 3 * 24 * 60 * 60 * 1000

const seen = () => {
  if (typeof localStorage === "undefined") return false
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return false
    const at = Number(raw)
    if (!Number.isFinite(at)) return false
    return Date.now() - at < gap
  } catch {
    return false
  }
}

const note = () => {
  if (typeof localStorage === "undefined") return
  try {
    localStorage.setItem(key, `${Date.now()}`)
  } catch {
    return
  }
}

const platform: Platform = {
  platform: "mobile",
  version: pkg.version,
  openLink,
  back,
  forward: () => window.history.forward(),
  restart: async () => window.location.reload(),
  notify,
  notifyTaskDone,
  pulse,
  openNotificationSettings,
  openPowerSettings,
  backgroundStatus,
  fetch: nativeFetch,
  storage: Capacitor.isNativePlatform() ? nativeStorage : undefined,
  configureTracker: (input) => {
    write(input.url)
    void writeNativeDefault(input.url)
    return configureTracker(input)
  },
  setTrackerNotify,
  trackSession,
  untrackSession,
  getDefaultServer: async () => {
    const stored = (await readNative()) ?? read()
    return stored ? ServerConnection.Key.make(stored) : null
  },
  setDefaultServer: (value) => {
    write(value)
    void writeNativeDefault(value)
  },
}

void bindBack()
void bindLifecycle()

const route = () => {
  void consumeLaunchHref().then((href) => {
    if (!href) return
    window.setTimeout(() => handleNotificationClick(href), 0)
  })
}

route()
window.addEventListener("opencode:resume", route)

void ensureNotifications()

function Sync() {
  const settings = useSettings()

  createEffect(() => {
    setTrackerSound(settings.sounds.agentEnabled() ? settings.sounds.agent() : undefined)
  })

  return null
}

void backgroundStatus().then((info) => {
  if (seen()) return
  const maker = info.maker.toLowerCase()
  const oem = maker.includes("vivo") || maker.includes("iqoo")
  if (!oem) return

  if (!info.battery) return

  const go = window.confirm(
    "检测到 iQOO/vivo 省电限制，后台任务通知可能失效。现在打开电池优化设置并允许 OpenCode 后台运行吗？",
  )
  if (go) void openPowerSettings()
  note()
})

void initialUrl().then((url) => {
  render(
    () => (
      <PlatformProvider value={platform}>
        <AppBaseProviders>
          <AppInterface
            defaultServer={ServerConnection.Key.make(url)}
            servers={[{ type: "http", http: { url } }]}
            disableHealthCheck
          >
            <Sync />
          </AppInterface>
        </AppBaseProviders>
      </PlatformProvider>
    ),
    root,
  )
})
