import { Capacitor } from "@capacitor/core"
import { App } from "@capacitor/app"
import { Haptics, ImpactStyle } from "@capacitor/haptics"
import { LocalNotifications } from "@capacitor/local-notifications"
import { handleNotificationClick } from "@opencode-ai/app"
import { alert, task } from "./bridge-native"

let ready = false
let boot: Promise<void> | undefined
let note = Date.now()

const next = () => {
  note = Math.max(note + 1, Date.now())
  return note
}

async function init() {
  if (ready) return
  if (boot) return boot

  if (!Capacitor.isNativePlatform()) return

  boot = (async () => {
    await LocalNotifications.requestPermissions().catch(() => undefined)

    await LocalNotifications.createChannel({
      id: task,
      name: "任务完成",
      description: "本地任务完成提醒",
      importance: 5,
      vibration: true,
    })

    await LocalNotifications.createChannel({
      id: alert,
      name: "OpenCode 通知",
      description: "OpenCode 系统通知",
      importance: 4,
      vibration: true,
    })

    await LocalNotifications.addListener("localNotificationActionPerformed", (event) => {
      const href = event.notification.extra?.href
      if (typeof href !== "string") return
      handleNotificationClick(href)
    })

    ready = true
  })().finally(() => {
    boot = undefined
  })

  return boot
}

const active = async () => {
  const state = await App.getState().catch(() => ({ isActive: true }))
  return !!state.isActive
}

export async function pulse(type: "task" | "alert" = "alert") {
  if (!Capacitor.isNativePlatform()) return
  if (!(await active())) return
  await Haptics.impact({ style: type === "task" ? ImpactStyle.Light : ImpactStyle.Medium }).catch(() => undefined)
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

    const item = new Notification(title, { body: body ?? "" })
    item.onclick = () => handleNotificationClick(href)
    return
  }

  if (await active()) return

  await LocalNotifications.schedule({
    notifications: [
      {
        id: next(),
        title,
        body: body ?? "",
        channelId: task,
        extra: { href },
      },
    ],
  })
}

export async function notify(title: string, body?: string, href?: string) {
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

    const item = new Notification(title, { body: body ?? "" })
    item.onclick = () => handleNotificationClick(href)
    return
  }

  if (await active()) return

  await LocalNotifications.schedule({
    notifications: [
      {
        id: next(),
        title,
        body: body ?? "",
        channelId: alert,
        extra: { href },
      },
    ],
  })
}

export async function ensureNotifications() {
  await init()
  const on = await LocalNotifications.areEnabled().catch(() => ({ value: true }))
  return on.value
}
