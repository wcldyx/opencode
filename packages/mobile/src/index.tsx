// @refresh reload

import { createEffect } from "solid-js"
import { render } from "solid-js/web"
import { AppBaseProviders, AppInterface, PlatformProvider, ServerConnection, type Platform } from "@opencode-ai/app"
import { useSettings } from "../../app/src/context/settings"
import pkg from "../package.json"
import { Capacitor } from "@capacitor/core"
import { nativeKeepalive } from "./bridge-native"
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

const storageName = (name?: string) => name ?? "default.dat"
const storageKey = (name: string | undefined, key: string) => `${storageName(name)}:${key}`
const nativeStorage = (name?: string): NativeStorage => ({
  getItem: async (key) => {
    const item = await nativeKeepalive.storageGet({ name: storageName(name), key }).catch(() => ({ value: undefined }))
    if (typeof item.value === "string") {
      if (typeof localStorage !== "undefined") localStorage.setItem(storageKey(name, key), item.value)
      return item.value
    }
    if (typeof localStorage === "undefined") return null
    return localStorage.getItem(storageKey(name, key))
  },
  setItem: async (key, value) => {
    await nativeKeepalive.storageSet({ name: storageName(name), key, value })
    if (typeof localStorage !== "undefined") localStorage.setItem(storageKey(name, key), value)
  },
  removeItem: async (key) => {
    await nativeKeepalive.storageRemove({ name: storageName(name), key })
    if (typeof localStorage !== "undefined") localStorage.removeItem(storageKey(name, key))
  },
})

const serverUrl = (value: unknown) => {
  if (typeof value === "string") return value
  if (!value || typeof value !== "object" || Array.isArray(value)) return
  const item = value as { http?: unknown; url?: unknown }
  if (item.http && typeof item.http === "object" && !Array.isArray(item.http)) {
    const http = item.http as { url?: unknown }
    return typeof http.url === "string" ? http.url : undefined
  }
  return typeof item.url === "string" ? item.url : undefined
}

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

const url = read() ?? readActiveServer() ?? import.meta.env.VITE_OPENCODE_SERVER_URL ?? "http://localhost:4096"
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
    return configureTracker(input)
  },
  setTrackerNotify,
  trackSession,
  untrackSession,
  getDefaultServer: async () => {
    const stored = read()
    return stored ? ServerConnection.Key.make(stored) : null
  },
  setDefaultServer: (value) => {
    write(value)
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
