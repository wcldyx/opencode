// @refresh reload

import { render } from "solid-js/web"
import { AppBaseProviders, AppInterface, PlatformProvider, ServerConnection, type Platform } from "@opencode-ai/app"
import pkg from "../package.json"
import {
  backgroundStatus,
  back,
  bindBack,
  bindLifecycle,
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
  trackSession,
  untrackSession,
} from "./bridge"

const root = document.getElementById("root")
if (!(root instanceof HTMLElement)) throw new Error("root not found")

const serverKey = "opencode.settings.dat:defaultServerUrl"
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

const url = read() ?? import.meta.env.VITE_OPENCODE_SERVER_URL ?? "http://localhost:4096"
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

const mark = () => {
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
  configureTracker,
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

void ensureNotifications().then((ok) => {
  if (ok) return
  const go = window.confirm("OpenCode 的系统通知已被关闭，后台保活通知将无法显示。现在打开通知设置吗？")
  if (!go) return
  void openNotificationSettings()
})

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
  mark()
})

render(
  () => (
    <PlatformProvider value={platform}>
      <AppBaseProviders>
        <AppInterface
          defaultServer={ServerConnection.Key.make(url)}
          servers={[{ type: "http", http: { url } }]}
          disableHealthCheck
        />
      </AppBaseProviders>
    </PlatformProvider>
  ),
  root,
)
