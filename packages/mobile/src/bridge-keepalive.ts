import { Capacitor } from "@capacitor/core"
import { nativeKeepalive } from "./bridge-native"

export async function configureTracker(input: { url: string; username?: string; password?: string; notify?: boolean }) {
  if (!Capacitor.isNativePlatform()) return
  await nativeKeepalive.configure(input).catch(() => undefined)
}

export async function setTrackerNotify(notify: boolean) {
  if (!Capacitor.isNativePlatform()) return
  await nativeKeepalive.setNotify({ notify }).catch(() => undefined)
}

export async function setTrackerSound(sound?: string) {
  if (!Capacitor.isNativePlatform()) return
  await nativeKeepalive.setSound({ sound }).catch(() => undefined)
}

export async function openNotificationSettings() {
  if (!Capacitor.isNativePlatform()) return
  await nativeKeepalive.openNotificationSettings().catch(() => undefined)
}

export async function consumeLaunchHref() {
  if (!Capacitor.isNativePlatform()) return undefined
  const item = await nativeKeepalive.consumeLaunchHref().catch(() => ({ href: undefined }))
  return typeof item.href === "string" && item.href ? item.href : undefined
}

export async function backgroundStatus() {
  if (!Capacitor.isNativePlatform()) return { maker: "", model: "", battery: false }
  return nativeKeepalive.backgroundStatus().catch(() => ({ maker: "", model: "", battery: false }))
}

export async function openPowerSettings() {
  if (!Capacitor.isNativePlatform()) return
  await nativeKeepalive.openPowerSettings().catch(() => undefined)
}

export async function openAutoStartSettings() {
  if (!Capacitor.isNativePlatform()) return
  await nativeKeepalive.openAutoStartSettings().catch(() => undefined)
}

export async function trackSession(sessionID: string, directory?: string) {
  if (!Capacitor.isNativePlatform()) return
  if (!sessionID) return
  await nativeKeepalive.track({ sessionID, directory }).catch(() => undefined)
}

export async function untrackSession(sessionID: string) {
  if (!Capacitor.isNativePlatform()) return
  if (!sessionID) return
  await nativeKeepalive.untrack({ sessionID }).catch(() => undefined)
}
