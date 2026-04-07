import type { Session } from "@opencode-ai/sdk/v2/client"
import { directoryAliases } from "@/utils/directory"
import type { RootLoadArgs } from "./types"

async function loadOne(input: RootLoadArgs, directory: string) {
  try {
    const result = await input.list({ directory, roots: true, limit: input.limit })
    return {
      data: result.data ?? [],
      limited: true,
    }
  } catch {
    const result = await input.list({ directory, roots: true })
    return {
      data: result.data ?? [],
      limited: false,
    }
  }
}

function merge(list: Session[][]) {
  const map = new Map<string, Session>()
  for (const group of list) {
    for (const item of group) {
      if (!item?.id) continue
      if (map.has(item.id)) continue
      map.set(item.id, item)
    }
  }
  return [...map.values()]
}

export async function loadRootSessionsWithFallback(input: RootLoadArgs) {
  const result = await Promise.all(directoryAliases(input.directory).map((directory) => loadOne(input, directory)))
  return {
    data: merge(result.map((item) => item.data)),
    limit: input.limit,
    limited: result.some((item) => item.limited),
  } as const
}

export const SessionLoadTesting = {
  aliases: directoryAliases,
}

export function estimateRootSessionTotal(input: { count: number; limit: number; limited: boolean }) {
  if (!input.limited) return input.count
  if (input.count < input.limit) return input.count
  return input.count + 1
}
