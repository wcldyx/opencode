export const serverStoreName = "opencode.global.dat"
export const serverStoreKey = "server"
export const serverBackupKey = "server.backup"

type Source = string | null | undefined | (() => string | null | undefined | Promise<string | null | undefined>)

export const serverUrl = (value: unknown) => {
  if (typeof value === "string") return value
  if (!value || typeof value !== "object" || Array.isArray(value)) return
  const item = value as { http?: unknown; url?: unknown }
  if (item.http && typeof item.http === "object" && !Array.isArray(item.http)) {
    const http = item.http as { url?: unknown }
    return typeof http.url === "string" ? http.url : undefined
  }
  return typeof item.url === "string" ? item.url : undefined
}

export const isLocalServerUrl = (value: string) => {
  try {
    const host = new URL(value).hostname.toLowerCase()
    return host === "localhost" || host === "127.0.0.1" || host === "::1"
  } catch {
    return false
  }
}

export const serverStateUrls = (raw: string | undefined | null) => {
  if (!raw) return []
  try {
    const state = JSON.parse(raw) as { active?: unknown; list?: unknown }
    return [
      typeof state.active === "string" && /^https?:\/\//.test(state.active) ? state.active : undefined,
      ...(Array.isArray(state.list) ? state.list.map(serverUrl) : []),
    ].filter((item): item is string => !!item && /^https?:\/\//.test(item))
  } catch {
    return []
  }
}

export const hasRemoteServer = (raw: string | undefined | null) =>
  serverStateUrls(raw).some((item) => !isLocalServerUrl(item))

export const readStoredServer = (raw: string | undefined | null) => {
  if (!raw) return null
  try {
    const state = JSON.parse(raw) as { active?: unknown; list?: unknown }
    const active = typeof state.active === "string" && /^https?:\/\//.test(state.active) ? state.active : undefined
    if (!active) return null
    const list = Array.isArray(state.list) ? state.list : []
    return list.map(serverUrl).find((item) => item === active) ?? active
  } catch {
    return null
  }
}

const valueOf = async (source: Source) => (typeof source === "function" ? source() : source)

export async function protectServerState(input: {
  next: string
  current?: Source
  backup?: Source
  local?: Source
  recovered?: Source
}) {
  if (hasRemoteServer(input.next)) return input.next
  for (const source of [input.current, input.backup, input.local, input.recovered]) {
    const value = await valueOf(source)
    if (typeof value === "string" && hasRemoteServer(value)) return value
  }
  return input.next
}
