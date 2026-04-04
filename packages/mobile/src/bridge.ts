import { Capacitor, registerPlugin } from "@capacitor/core"
import { Browser } from "@capacitor/browser"
import { App } from "@capacitor/app"
import { Haptics, ImpactStyle } from "@capacitor/haptics"
import { LocalNotifications } from "@capacitor/local-notifications"
import { handleNotificationClick } from "@opencode-ai/app"

type Meta = {
  status: number
  headers?: Record<string, string>
}

type Chunk = {
  id: string
  chunk: string
}

type Native = {
  request(input: {
    url: string
    method: string
    headers?: Record<string, string>
    body?: string
  }): Promise<Meta & { data?: string }>
  stream(input: {
    id: string
    url: string
    method: string
    headers?: Record<string, string>
    body?: string
  }): Promise<Meta>
  abort(input: { id: string }): Promise<void>
  addListener(name: "nativeHttpChunk", cb: (x: Chunk) => void): Promise<{ remove(): Promise<void> }>
  addListener(name: "nativeHttpDone", cb: (x: { id: string }) => void): Promise<{ remove(): Promise<void> }>
  addListener(
    name: "nativeHttpError",
    cb: (x: { id: string; message: string }) => void,
  ): Promise<{ remove(): Promise<void> }>
}

type Keepalive = {
  configure(input: { url: string; username?: string; password?: string }): Promise<void>
  track(input: { sessionID: string }): Promise<void>
  openNotificationSettings(): Promise<void>
}

const channel = "task-done"
const webFetch = globalThis.fetch.bind(globalThis)
const nativeHttp = registerPlugin<Native>("NativeHttp")
const nativeKeepalive = registerPlugin<Keepalive>("NativeKeepalive")
let ready = false

const streamPath = (url: string) => {
  const path = new URL(url).pathname
  return path.endsWith("/event") || path.endsWith("/sync-event")
}

const decode = (chunk: string) => {
  const raw = globalThis.atob(chunk)
  const buf = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i += 1) buf[i] = raw.charCodeAt(i)
  return buf
}

async function init() {
  if (ready) return
  ready = true

  if (!Capacitor.isNativePlatform()) return

  await LocalNotifications.requestPermissions().catch(() => undefined)

  await LocalNotifications.createChannel({
    id: channel,
    name: "任务完成",
    description: "本地任务完成提醒",
    importance: 5,
    vibration: true,
  })

  await LocalNotifications.addListener("localNotificationActionPerformed", (event) => {
    const href = event.notification.extra?.href
    if (typeof href !== "string") return
    handleNotificationClick(href)
  })
}

export async function notifyTaskDone(title: string, body?: string, href?: string) {
  await init()

  if (!Capacitor.isNativePlatform()) {
    if (!("Notification" in window)) return

    const permission =
      Notification.permission === "default"
        ? await Notification.requestPermission().catch(() => "denied")
        : Notification.permission

    if (permission !== "granted") return

    const inView = document.visibilityState === "visible" && document.hasFocus()
    if (inView) return

    const note = new Notification(title, { body: body ?? "" })
    note.onclick = () => handleNotificationClick(href)
    return
  }

  await Haptics.impact({ style: ImpactStyle.Light }).catch(() => undefined)
  await LocalNotifications.schedule({
    notifications: [
      {
        id: Date.now(),
        title,
        body: body ?? "",
        channelId: channel,
        extra: { href },
      },
    ],
  })
}

export async function openLink(url: string) {
  if (Capacitor.isNativePlatform()) {
    await Browser.open({ url })
    return
  }

  window.open(url, "_blank")
}

export async function nativeFetch(input: RequestInfo | URL, init?: RequestInit) {
  if (!Capacitor.isNativePlatform()) return webFetch(input, init)

  const req = input instanceof Request ? input : new Request(input, init)

  if (streamPath(req.url)) {
    const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined
    let dead = false
    let off: () => Promise<void> = async () => undefined
    const halt = () => {
      if (dead) return
      dead = true
      void off().finally(() => {
        void nativeHttp.abort({ id }).catch(() => undefined)
      })
    }
    const [chunk, done, err] = await Promise.all([
      nativeHttp.addListener("nativeHttpChunk", (x) => {
        if (x.id !== id) return
        controller?.enqueue(decode(x.chunk))
      }),
      nativeHttp.addListener("nativeHttpDone", async (x) => {
        if (x.id !== id) return
        await close()
      }),
      nativeHttp.addListener("nativeHttpError", async (x) => {
        if (x.id !== id) return
        await fail(new Error(x.message))
      }),
    ])

    off = async () => {
      req.signal.removeEventListener("abort", abort)
      await Promise.all([chunk.remove(), done.remove(), err.remove()]).catch(() => undefined)
    }

    const abort = () => {
      halt()
    }

    const close = async () => {
      if (dead) return
      dead = true
      await off()
      controller?.close()
    }

    const fail = async (e: Error) => {
      if (dead) return
      dead = true
      await off()
      controller?.error(e)
    }

    const body = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c
      },
      cancel() {
        halt()
      },
    })

    req.signal.addEventListener("abort", abort, { once: true })

    const meta = await nativeHttp.stream({
      id,
      url: req.url,
      method: req.method,
      headers: Object.fromEntries(req.headers.entries()),
      body: req.method === "GET" || req.method === "HEAD" ? undefined : await req.clone().text(),
    })

    const headers = new Headers()
    Object.entries(meta.headers ?? {}).forEach(([key, value]) => {
      headers.set(key, value)
    })

    const empty = req.method === "HEAD" || [101, 103, 204, 205, 304].includes(meta.status)
    if (empty) {
      await off()
      return new Response(null, { status: meta.status, headers })
    }

    return new Response(body, { status: meta.status, headers })
  }

  console.debug("[mobile] nativeFetch", req.method, req.url)
  const res = await nativeHttp.request({
    url: req.url,
    method: req.method,
    headers: Object.fromEntries(req.headers.entries()),
    body: req.method === "GET" || req.method === "HEAD" ? undefined : await req.clone().text(),
  })

  const headers = new Headers()
  Object.entries(res.headers ?? {}).forEach(([key, value]) => {
    if (typeof value !== "string") return
    headers.set(key, value)
  })

  const empty = req.method === "HEAD" || [101, 103, 204, 205, 304].includes(res.status)
  if (empty) {
    return new Response(null, {
      status: res.status,
      headers,
    })
  }

  const body = typeof res.data === "string" ? res.data : JSON.stringify(res.data ?? null)
  return new Response(body, {
    status: res.status,
    headers,
  })
}

export function bindBack() {
  if (!Capacitor.isNativePlatform()) return undefined

  return App.addListener("backButton", () => {
    back()
  })
}

export function back() {
  const e = new CustomEvent("opencode:back", { cancelable: true })
  if (!window.dispatchEvent(e)) return

  if (window.history.length > 1) {
    window.history.back()
    return
  }
  void App.exitApp()
}

export function bindLifecycle() {
  if (!Capacitor.isNativePlatform()) return undefined

  return App.addListener("appStateChange", (state) => {
    if (!state.isActive) return
    window.dispatchEvent(new Event("opencode:resume"))
  })
}

export async function configureTracker(input: { url: string; username?: string; password?: string }) {
  if (!Capacitor.isNativePlatform()) return
  await nativeKeepalive.configure(input).catch(() => undefined)
}

export async function ensureNotifications() {
  await init()
  const perm = await LocalNotifications.checkPermissions().catch(() => ({ display: "denied" as const }))
  const on = await LocalNotifications.areEnabled().catch(() => ({ value: false }))
  return perm.display === "granted" && on.value
}

export async function openNotificationSettings() {
  if (!Capacitor.isNativePlatform()) return
  await nativeKeepalive.openNotificationSettings().catch(() => undefined)
}

export async function trackSession(sessionID: string) {
  if (!Capacitor.isNativePlatform()) return
  if (!sessionID) return
  await nativeKeepalive.track({ sessionID }).catch(() => undefined)
}
