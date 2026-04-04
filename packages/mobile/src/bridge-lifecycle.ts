import { Capacitor } from "@capacitor/core"
import { Browser } from "@capacitor/browser"
import { App } from "@capacitor/app"

export async function openLink(url: string) {
  if (Capacitor.isNativePlatform()) {
    await Browser.open({ url })
    return
  }

  window.open(url, "_blank")
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
