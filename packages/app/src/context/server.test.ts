import { describe, expect, test } from "bun:test"
import { ServerTesting } from "./server"

describe("server project normalization", () => {
  test("normalizes and dedupes stored projects", () => {
    expect(
      ServerTesting.normalizeProjects([
        { worktree: "G:\\mywork\\myclaw-2", expanded: false },
        { worktree: "G:/mywork/myclaw-2/", expanded: true },
      ]),
    ).toEqual([{ worktree: "G:/mywork/myclaw-2", expanded: true }])
  })

  test("migrates persisted server projects and last project", () => {
    expect(
      ServerTesting.migrate({
        projects: {
          local: [
            { worktree: "G:\\mywork\\myclaw-2", expanded: false },
            { worktree: "G:/mywork/myclaw-2/", expanded: true },
          ],
        },
        lastProject: {
          local: "G:\\mywork\\myclaw-2\\",
        },
      }),
    ).toEqual({
      projects: {
        local: [{ worktree: "G:/mywork/myclaw-2", expanded: true }],
      },
      lastProject: {
        local: "G:/mywork/myclaw-2",
      },
    })
  })
})
