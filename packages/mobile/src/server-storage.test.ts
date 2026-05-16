import { describe, expect, test } from "bun:test"
import { hasRemoteServer, protectServerState, readStoredServer } from "./server-storage"

const remote = "https://remote.example.com"
const remoteState = JSON.stringify({
  list: [{ type: "http", http: { url: remote } }],
  projects: {},
  lastProject: {},
  active: remote,
})
const localState = JSON.stringify({
  list: [{ type: "http", http: { url: "http://localhost:4096" } }],
  projects: {},
  lastProject: {},
  active: "http://localhost:4096",
})
const emptyState = JSON.stringify({ list: [], projects: {}, lastProject: {} })

describe("mobile server storage protection", () => {
  test("detects persisted remote servers", () => {
    expect(hasRemoteServer(remoteState)).toBe(true)
    expect(hasRemoteServer(localState)).toBe(false)
    expect(hasRemoteServer("{bad json")).toBe(false)
  })

  test("reads the active stored server", () => {
    expect(readStoredServer(remoteState)).toBe(remote)
    expect(readStoredServer("{bad json")).toBeNull()
  })

  test("keeps a saved remote server over empty, localhost, or malformed replacements", async () => {
    expect(await protectServerState({ next: emptyState, current: remoteState })).toBe(remoteState)
    expect(await protectServerState({ next: localState, backup: remoteState })).toBe(remoteState)
    expect(await protectServerState({ next: "{bad json", local: remoteState })).toBe(remoteState)
    expect(await protectServerState({ next: emptyState, recovered: async () => remoteState })).toBe(remoteState)
  })

  test("allows a new remote server to replace an older one", async () => {
    const next = JSON.stringify({
      list: [{ type: "http", http: { url: "https://new.example.com" } }],
      projects: {},
      lastProject: {},
      active: "https://new.example.com",
    })
    expect(await protectServerState({ next, current: remoteState })).toBe(next)
  })
})
