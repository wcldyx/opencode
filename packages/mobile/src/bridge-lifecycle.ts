import { Capacitor } from "@capacitor/core"
import { Browser } from "@capacitor/browser"
import { App } from "@capacitor/app"

let last = 0

const top = <T extends Element>(selector: string) => Array.from(document.querySelectorAll<T>(selector)).at(-1)

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
    const now = Date.now()
    if (now - last < 250) {
      return
    }
    last = now
    back()
  })
}

export function back() {
  const close = top<HTMLElement>("[data-slot='dialog-close-button']")
  const overlay = top<HTMLElement>("[data-component='dialog-overlay']")
  if (close) {
    close.click()
    return
  }
  if (overlay) {
    overlay.click()
    return
  }

  const e = new CustomEvent("opencode:back", { cancelable: true })
  const ok = window.dispatchEvent(e)
  if (!ok) return

  if (window.history.length > 1) {
    window.history.back()
    return
  }
  if (!Capacitor.isNativePlatform()) return
  void App.exitApp()
}

export function bindLifecycle() {
  if (!Capacitor.isNativePlatform()) return undefined

  return App.addListener("appStateChange", (state) => {
    if (!state.isActive) return
    window.dispatchEvent(new Event("opencode:resume"))
  })
}
