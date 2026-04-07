import { describe, expect, test } from "bun:test"
import type { Session } from "@opencode-ai/sdk/v2/client"
import { canDisposeDirectory, pickDirectoriesToEvict } from "./global-sync/eviction"
import { estimateRootSessionTotal, loadRootSessionsWithFallback, SessionLoadTesting } from "./global-sync/session-load"

const session = (id: string, directory: string, updated: number) =>
  ({
    id,
    slug: "",
    projectID: "",
    directory,
    title: "",
    version: "v2",
    parentID: undefined,
    messageCount: 0,
    permissions: { session: {}, share: {} },
    time: { created: updated, updated, archived: undefined },
  }) as Session

describe("pickDirectoriesToEvict", () => {
  test("keeps pinned stores and evicts idle stores", () => {
    const now = 5_000
    const picks = pickDirectoriesToEvict({
      stores: ["a", "b", "c", "d"],
      state: new Map([
        ["a", { lastAccessAt: 1_000 }],
        ["b", { lastAccessAt: 4_900 }],
        ["c", { lastAccessAt: 4_800 }],
        ["d", { lastAccessAt: 3_000 }],
      ]),
      pins: new Set(["a"]),
      max: 2,
      ttl: 1_500,
      now,
    })

    expect(picks).toEqual(["d", "c"])
  })
})

describe("loadRootSessionsWithFallback", () => {
  test("uses limited roots query when supported", async () => {
    const calls: Array<{ directory: string; roots: true; limit?: number }> = []

    const result = await loadRootSessionsWithFallback({
      directory: "dir",
      limit: 10,
      list: async (query) => {
        calls.push(query)
        return { data: [] }
      },
    })

    expect(result.data).toEqual([])
    expect(result.limited).toBe(true)
    expect(calls).toEqual([{ directory: "dir", roots: true, limit: 10 }])
  })

  test("falls back to full roots query on limited-query failure", async () => {
    const calls: Array<{ directory: string; roots: true; limit?: number }> = []

    const result = await loadRootSessionsWithFallback({
      directory: "dir",
      limit: 25,
      list: async (query) => {
        calls.push(query)
        if (query.limit) throw new Error("unsupported")
        return { data: [] }
      },
    })

    expect(result.data).toEqual([])
    expect(result.limited).toBe(false)
    expect(calls).toEqual([
      { directory: "dir", roots: true, limit: 25 },
      { directory: "dir", roots: true },
    ])
  })

  test("loads both slash variants for windows directories and merges sessions", async () => {
    const calls: Array<{ directory: string; roots: true; limit?: number }> = []

    const result = await loadRootSessionsWithFallback({
      directory: "G:/mywork/myclaw-2",
      limit: 10,
      list: async (query) => {
        calls.push(query)
        if (query.directory === "G:/mywork/myclaw-2") {
          return {
            data: [session("a", "G:/mywork/myclaw-2", 1)],
          }
        }
        return {
          data: [session("a", "G:\\mywork\\myclaw-2", 1), session("b", "G:\\mywork\\myclaw-2", 2)],
        }
      },
    })

    expect(result.data?.map((item) => item.id)).toEqual(["a", "b"])
    expect(calls).toEqual([
      { directory: "G:/mywork/myclaw-2", roots: true, limit: 10 },
      { directory: "G:\\mywork\\myclaw-2", roots: true, limit: 10 },
    ])
  })
})

describe("SessionLoadTesting.aliases", () => {
  test("returns both slash variants for windows paths", () => {
    expect(SessionLoadTesting.aliases("G:/mywork/myclaw-2")).toEqual([
      "G:/mywork/myclaw-2",
      "G:\\mywork\\myclaw-2",
    ])
  })

  test("keeps posix paths unchanged", () => {
    expect(SessionLoadTesting.aliases("/tmp/demo")).toEqual(["/tmp/demo"])
  })
})

describe("estimateRootSessionTotal", () => {
  test("keeps exact total for full fetches", () => {
    expect(estimateRootSessionTotal({ count: 42, limit: 10, limited: false })).toBe(42)
  })

  test("marks has-more for full-limit limited fetches", () => {
    expect(estimateRootSessionTotal({ count: 10, limit: 10, limited: true })).toBe(11)
  })

  test("keeps exact total when limited fetch is under limit", () => {
    expect(estimateRootSessionTotal({ count: 9, limit: 10, limited: true })).toBe(9)
  })
})

describe("canDisposeDirectory", () => {
  test("rejects pinned or inflight directories", () => {
    expect(
      canDisposeDirectory({
        directory: "dir",
        hasStore: true,
        pinned: true,
        booting: false,
        loadingSessions: false,
      }),
    ).toBe(false)
    expect(
      canDisposeDirectory({
        directory: "dir",
        hasStore: true,
        pinned: false,
        booting: true,
        loadingSessions: false,
      }),
    ).toBe(false)
    expect(
      canDisposeDirectory({
        directory: "dir",
        hasStore: true,
        pinned: false,
        booting: false,
        loadingSessions: true,
      }),
    ).toBe(false)
  })

  test("accepts idle unpinned directory store", () => {
    expect(
      canDisposeDirectory({
        directory: "dir",
        hasStore: true,
        pinned: false,
        booting: false,
        loadingSessions: false,
      }),
    ).toBe(true)
  })
})
