import { describe, expect, test } from "bun:test"
import { directoryAliases, directoryKey, sameDirectory, toServerDirectory } from "./directory"

describe("directoryKey", () => {
  test("normalizes windows separators, drive casing, and trailing slashes", () => {
    expect(directoryKey("g:\\mywork\\myclaw-2\\")).toBe("G:/mywork/myclaw-2")
    expect(directoryKey("G:/mywork/myclaw-2/")).toBe("G:/mywork/myclaw-2")
  })

  test("preserves roots", () => {
    expect(directoryKey("/")).toBe("/")
    expect(directoryKey("C:\\")).toBe("C:/")
  })
})

describe("sameDirectory", () => {
  test("matches slash variants for the same windows path", () => {
    expect(sameDirectory("G:/mywork/myclaw-2", "G:\\mywork\\myclaw-2")).toBe(true)
  })

  test("rejects different directories", () => {
    expect(sameDirectory("G:/mywork/a", "G:/mywork/b")).toBe(false)
  })
})

describe("toServerDirectory", () => {
  test("converts windows paths to backslash form", () => {
    expect(toServerDirectory("g:/mywork/myclaw-2/")).toBe("G:\\mywork\\myclaw-2")
    expect(toServerDirectory("G:\\mywork\\myclaw-2")).toBe("G:\\mywork\\myclaw-2")
  })

  test("keeps posix paths unchanged", () => {
    expect(toServerDirectory("/tmp/demo")).toBe("/tmp/demo")
  })
})

describe("directoryAliases", () => {
  test("returns both windows slash variants", () => {
    expect(directoryAliases("G:/mywork/myclaw-2")).toEqual(["G:/mywork/myclaw-2", "G:\\mywork\\myclaw-2"])
  })

  test("keeps posix paths unchanged", () => {
    expect(directoryAliases("/tmp/demo")).toEqual(["/tmp/demo"])
  })
})
