import { registerPlugin } from "@capacitor/core"

export type Meta = {
  status: number
  headers?: Record<string, string>
}

export type Chunk = {
  id: string
  chunk: string
}

export type Native = {
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

export type Keepalive = {
  configure(input: { url: string; username?: string; password?: string; notify?: boolean }): Promise<void>
  track(input: { sessionID: string; directory?: string }): Promise<void>
  untrack(input: { sessionID: string }): Promise<void>
  setNotify(input: { notify: boolean }): Promise<void>
  setSound(input: { sound?: string }): Promise<void>
  consumeLaunchHref(): Promise<{ href?: string }>
  openNotificationSettings(): Promise<void>
  backgroundStatus(): Promise<{ maker: string; model: string; battery: boolean }>
  openPowerSettings(): Promise<void>
  openAutoStartSettings(): Promise<void>
}

export const task = "opencode-task"
export const alert = "opencode-alert"
export const nativeHttp = registerPlugin<Native>("NativeHttp")
export const nativeKeepalive = registerPlugin<Keepalive>("NativeKeepalive")
