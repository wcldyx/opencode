import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { FileIcon } from "@opencode-ai/ui/file-icon"
import { List } from "@opencode-ai/ui/list"
import type { ListRef } from "@opencode-ai/ui/list"
import { TextField } from "@opencode-ai/ui/text-field"
import { showToast } from "@opencode-ai/ui/toast"
import { getDirectory, getFilename } from "@opencode-ai/util/path"
import fuzzysort from "fuzzysort"
import { createEffect, createMemo, createResource, createSignal, For, Show } from "solid-js"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { useLayout } from "@/context/layout"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"

interface DialogSelectDirectoryProps {
  title?: string
  multiple?: boolean
  onSelect: (result: string | string[] | null) => void
}

type Row = {
  absolute: string
  search: string
  group: "recent" | "folders"
}

const drives = Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i) + ":/")

function cleanInput(value: string) {
  const first = (value ?? "").split(/\r?\n/)[0] ?? ""
  return first.replace(/[\u0000-\u001F\u007F]/g, "").trim()
}

function normalizePath(input: string) {
  const v = input.replaceAll("\\", "/")
  if (v.startsWith("//") && !v.startsWith("///")) return "//" + v.slice(2).replace(/\/+/g, "/")
  return v.replace(/\/+/g, "/")
}

function normalizeDriveRoot(input: string) {
  const v = normalizePath(input)
  if (/^\/[A-Za-z]:\/?$/.test(v)) return v.slice(1).replace(/\/?$/, "/")
  if (/^[A-Za-z]:$/.test(v)) return v + "/"
  return v
}

function windowsPath(input: string) {
  const v = normalizeDriveRoot(input)
  return /^[A-Za-z]:\//.test(v) || v.startsWith("//")
}

function trimTrailing(input: string) {
  const v = normalizeDriveRoot(input)
  if (v === "/") return v
  if (v === "//") return v
  if (/^[A-Za-z]:\/$/.test(v)) return v
  return v.replace(/\/+$/, "")
}

function joinPath(base: string | undefined, rel: string) {
  const b = trimTrailing(base ?? "")
  const r = trimTrailing(rel).replace(/^\/+/, "")
  if (!b) return r
  if (!r) return b
  if (b.endsWith("/")) return b + r
  return b + "/" + r
}

function rootOf(input: string) {
  const v = normalizeDriveRoot(input)
  if (v.startsWith("//")) return "//"
  if (v.startsWith("/")) return "/"
  if (/^[A-Za-z]:\//.test(v)) return v.slice(0, 3)
  return ""
}

function parentOf(input: string) {
  const v = trimTrailing(input)
  if (v === "/") return v
  if (v === "//") return v
  if (/^[A-Za-z]:\/$/.test(v)) return v

  const i = v.lastIndexOf("/")
  if (i <= 0) return "/"
  if (i === 2 && /^[A-Za-z]:/.test(v)) return v.slice(0, 3)
  return v.slice(0, i)
}

function crumb(input: string) {
  const v = trimTrailing(input)
  if (!v) return [] as Array<{ name: string; path: string }>
  if (v === "/" || v === "//") return [{ name: v, path: v }]
  if (/^[A-Za-z]:\/$/.test(v)) return [{ name: v, path: v }]

  if (/^[A-Za-z]:\//.test(v)) {
    const root = v.slice(0, 3)
    const rest = v.slice(3).split("/").filter(Boolean)
    const out = [{ name: root, path: root }]
    let cur = root
    for (const part of rest) {
      cur = joinPath(cur, part)
      out.push({ name: part, path: cur })
    }
    return out
  }

  const parts = v.replace(/^\//, "").split("/").filter(Boolean)
  if (v.startsWith("/")) {
    const out = [{ name: "/", path: "/" }]
    let cur = ""
    for (const part of parts) {
      cur = joinPath(cur, part)
      out.push({ name: part, path: cur })
    }
    return out
  }

  let cur = ""
  return parts.map((part) => {
    cur = joinPath(cur, part)
    return { name: part, path: cur }
  })
}

function modeOf(input: string) {
  const raw = normalizeDriveRoot(input.trim())
  if (!raw) return "relative" as const
  if (raw.startsWith("~")) return "tilde" as const
  if (rootOf(raw)) return "absolute" as const
  return "relative" as const
}

function tildeOf(absolute: string, home: string) {
  const full = trimTrailing(absolute)
  if (!home) return ""

  const hn = trimTrailing(home)
  const lc = full.toLowerCase()
  const hc = hn.toLowerCase()
  if (lc === hc) return "~"
  if (lc.startsWith(hc + "/")) return "~" + full.slice(hn.length)
  return ""
}

function displayPath(path: string, input: string, home: string) {
  const full = trimTrailing(path)
  if (modeOf(input) === "absolute") return full
  if (windowsPath(full) && !input.trim().startsWith("~")) return full
  return tildeOf(full, home) || full
}

function toRow(absolute: string, home: string, group: Row["group"]): Row {
  const full = trimTrailing(absolute)
  const tilde = tildeOf(full, home)
  const withSlash = (value: string) => {
    if (!value) return ""
    if (value.endsWith("/")) return value
    return value + "/"
  }

  const search = Array.from(
    new Set([full, withSlash(full), tilde, withSlash(tilde), getFilename(full)].filter(Boolean)),
  ).join("\n")
  return { absolute: full, search, group }
}

function uniqueRows(rows: Row[]) {
  const seen = new Set<string>()
  return rows.filter((row) => {
    if (seen.has(row.absolute)) return false
    seen.add(row.absolute)
    return true
  })
}

function useDirectorySearch(args: {
  sdk: ReturnType<typeof useGlobalSDK>
  start: () => string | undefined
  home: () => string
}) {
  const cache = new Map<string, Promise<Array<{ name: string; absolute: string }>>>()
  let roots: Promise<string[]> | undefined
  let current = 0

  const windows = () => windowsPath(args.home()) || windowsPath(args.start() ?? "")

  const scoped = (value: string) => {
    const base = args.start()
    if (!base) return

    const raw = normalizeDriveRoot(value)
    if (!raw) return { directory: trimTrailing(base), path: "" }

    const h = args.home()
    if (raw === "~") return { directory: trimTrailing(h || base), path: "" }
    if (raw.startsWith("~/")) return { directory: trimTrailing(h || base), path: raw.slice(2) }

    const root = rootOf(raw)
    if (root) return { directory: trimTrailing(root), path: raw.slice(root.length) }
    return { directory: trimTrailing(base), path: raw }
  }

  const dirs = async (dir: string) => {
    const key = trimTrailing(dir)
    const existing = cache.get(key)
    if (existing) return existing

    const request = args.sdk.client.file
      .list({ directory: key, path: "" })
      .then((x) => x.data ?? [])
      .catch(() => [])
      .then((nodes) =>
        nodes
          .filter((n) => n.type === "directory")
          .map((n) => ({
            name: n.name,
            absolute: trimTrailing(normalizeDriveRoot(n.absolute)),
          })),
      )

    cache.set(key, request)
    return request
  }

  const listRoots = async () => {
    if (!windows()) return [] as string[]
    if (roots) return roots

    roots = Promise.all(
      drives.map(async (dir) => {
        const rows = await args.sdk.client.file
          .list({ directory: dir, path: "" })
          .then((x) => x.data ?? [])
          .catch(() => [])
        const ok = rows.some((row) => normalizeDriveRoot(row.absolute).toLowerCase().startsWith(dir.toLowerCase()))
        if (!ok) return
        return trimTrailing(dir)
      }),
    ).then((items) => items.filter((x): x is string => Boolean(x)))

    return roots
  }

  const match = async (dir: string, query: string, limit: number) => {
    const items = await dirs(dir)
    if (!query) return items.slice(0, limit).map((x) => x.absolute)
    return fuzzysort.go(query, items, { key: "name", limit }).map((x) => x.obj.absolute)
  }

  return async (filter: string) => {
    const token = ++current
    const active = () => token === current

    const value = cleanInput(filter)
    if (!value && windows()) return listRoots()

    const scopedInput = scoped(value)
    if (!scopedInput) return [] as string[]

    const raw = normalizeDriveRoot(value)
    const isPath = raw.startsWith("~") || !!rootOf(raw) || raw.includes("/")
    const query = normalizeDriveRoot(scopedInput.path)

    const find = () =>
      args.sdk.client.find
        .files({ directory: scopedInput.directory, query, type: "directory", limit: 50 })
        .then((x) => x.data ?? [])
        .catch(() => [])

    if (!isPath) {
      const results = await find()
      if (!active()) return []
      return results.map((rel) => joinPath(scopedInput.directory, rel)).slice(0, 50)
    }

    const segments = query.replace(/^\/+/, "").split("/")
    const head = segments.slice(0, segments.length - 1).filter((x) => x && x !== ".")
    const tail = segments[segments.length - 1] ?? ""

    const cap = 12
    const branch = 4
    let paths = [scopedInput.directory]
    for (const part of head) {
      if (!active()) return []
      if (part === "..") {
        paths = paths.map(parentOf)
        continue
      }

      const next = (await Promise.all(paths.map((p) => match(p, part, branch)))).flat()
      if (!active()) return []
      paths = Array.from(new Set(next)).slice(0, cap)
      if (paths.length === 0) return [] as string[]
    }

    const out = (await Promise.all(paths.map((p) => match(p, tail, 50)))).flat()
    if (!active()) return []
    const deduped = Array.from(new Set(out))
    const base = raw.startsWith("~") ? trimTrailing(scopedInput.directory) : ""
    const expand = !raw.endsWith("/")
    if (!expand || !tail) {
      const items = base ? Array.from(new Set([base, ...deduped])) : deduped
      return items.slice(0, 50)
    }

    const needle = tail.toLowerCase()
    const exact = deduped.filter((p) => getFilename(p).toLowerCase() === needle)
    const target = exact[0]
    if (!target) return deduped.slice(0, 50)

    const children = await match(target, "", 30)
    if (!active()) return []
    const items = Array.from(new Set([...deduped, ...children]))
    return (base ? Array.from(new Set([base, ...items])) : items).slice(0, 50)
  }
}

export function DialogSelectDirectory(props: DialogSelectDirectoryProps) {
  const sync = useGlobalSync()
  const sdk = useGlobalSDK()
  const layout = useLayout()
  const dialog = useDialog()
  const language = useLanguage()
  const platform = usePlatform()

  const [filter, setFilter] = createSignal("")
  const [focus, setFocus] = createSignal("")
  const [cwd, setCwd] = createSignal("")
  const [roots, setRoots] = createSignal(false)
  const [edit, setEdit] = createSignal<"" | "new" | "rename">("")
  const [draft, setDraft] = createSignal("")
  const [base, setBase] = createSignal("")
  let list: ListRef | undefined

  const missingBase = createMemo(() => !(sync.data.path.home || sync.data.path.directory))
  const [fallbackPath] = createResource(
    () => (missingBase() ? true : undefined),
    async () => {
      return sdk.client.path
        .get()
        .then((x) => x.data)
        .catch(() => undefined)
    },
    { initialValue: undefined },
  )

  const home = createMemo(() => sync.data.path.home || fallbackPath()?.home || "")
  const start = createMemo(
    () => sync.data.path.home || sync.data.path.directory || fallbackPath()?.home || fallbackPath()?.directory,
  )

  const directories = useDirectorySearch({
    sdk,
    home,
    start,
  })
  const canOpen = createMemo(() => Boolean(trimTrailing(cwd())) && !edit())

  createEffect(() => {
    const next = start()
    if (!next) return
    if (roots()) return
    if (cwd()) return
    setCwd(trimTrailing(next))
  })

  const recentProjects = createMemo(() => {
    const projects = layout.projects.list()
    const byProject = new Map<string, number>()

    for (const project of projects) {
      let at = 0
      const dirs = [project.worktree, ...(project.sandboxes ?? [])]
      for (const directory of dirs) {
        const sessions = sync.child(directory, { bootstrap: false })[0].session
        for (const session of sessions) {
          if (session.time.archived) continue
          const updated = session.time.updated ?? session.time.created
          if (updated > at) at = updated
        }
      }
      byProject.set(project.worktree, at)
    }

    return projects
      .map((project, index) => ({ project, at: byProject.get(project.worktree) ?? 0, index }))
      .sort((a, b) => b.at - a.at || a.index - b.index)
      .slice(0, 5)
      .map(({ project }) => {
        const row = toRow(project.worktree, home(), "recent")
        const name = project.name || getFilename(project.worktree)
        return {
          ...row,
          search: `${row.search}\n${name}`,
        }
      })
  })

  const items = async (value: string) => {
    const results = await directories(value)
    const directoryRows = results.map((absolute) => toRow(absolute, home(), "folders"))
    const showRecent = !cleanInput(value) && (roots() || !cwd())
    const recent = showRecent ? recentProjects() : []
    return uniqueRows([...recent, ...directoryRows])
  }

  function resolve(absolute: string) {
    props.onSelect(props.multiple ? [absolute] : absolute)
    dialog.close()
  }

  const openFolder = async () => {
    const target = trimTrailing(cwd())
    if (!target) return
    resolve(target)
  }

  const go = (absolute: string) => {
    setRoots(false)
    const next = trimTrailing(absolute)
    setFocus(next)
    setCwd(next)
    const text = displayPath(next, filter(), home())
    list?.setFilter(text.endsWith("/") ? text : text + "/")
  }

  const target = () => {
    const cur = trimTrailing(cwd())
    const hit = trimTrailing(focus())
    if (!cur) return ""
    if (!hit) return cur
    if (hit === cur) return hit
    const prefix = cur.endsWith("/") ? cur : cur + "/"
    if (hit.startsWith(prefix)) return hit
    return cur
  }

  const up = () => {
    const target = trimTrailing(cwd())
    if (!target) return
    if (/^[A-Za-z]:\/$/.test(normalizeDriveRoot(target))) {
      setRoots(true)
      setFocus("")
      setCwd("")
      list?.setFilter("")
      return
    }
    const next = parentOf(target)
    if (next === target) return
    go(next)
  }

  const act = async (task: () => Promise<void>) => {
    await task().catch((err) => {
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: err instanceof Error ? err.message : String(err),
      })
    })
  }

  const add = () => {
    const dir = trimTrailing(cwd())
    if (!dir) return
    setBase(dir)
    setDraft("")
    setEdit("new")
  }

  const rename = () => {
    const item = target()
    if (!item) return
    if (/^[A-Za-z]:\/$/.test(normalizeDriveRoot(item)) || item === "/" || item === "//") return
    setBase(item)
    setDraft(getFilename(item))
    setEdit("rename")
  }

  const save = () =>
    act(async () => {
      const name = draft().trim()
      if (!name) {
        setEdit("")
        return
      }
      if (name.includes("/") || name.includes("\\")) throw new Error(language.t("dialog.directory.error.invalidName"))

      if (edit() === "new") {
        const dir = trimTrailing(base() || cwd())
        if (!dir) return
        await sdk.client.file.mkdir({ directory: dir, path: name })
        setEdit("")
        go(joinPath(dir, name))
        return
      }

      if (edit() === "rename") {
        const item = trimTrailing(base() || target())
        if (!item) return
        const parent = parentOf(item)
        const old = getFilename(item)
        if (name === old) {
          setEdit("")
          return
        }
        await sdk.client.file.rename({ directory: parent, from: old, to: name })
        setEdit("")
        go(joinPath(parent, name))
      }
    })

  const remove = () =>
    act(async () => {
      const item = target()
      if (!item) return
      if (/^[A-Za-z]:\/$/.test(normalizeDriveRoot(item)) || item === "/" || item === "//") return
      const name = getFilename(item)
      if (!window.confirm(language.t("dialog.directory.confirm.delete", { name }))) return
      const parent = parentOf(item)
      await sdk.client.file.rmdir({ directory: parent, path: name })
      go(parent)
    })

  return (
    <Dialog title={props.title ?? language.t("command.project.open")}>
      <div class="h-full min-h-0 flex flex-col gap-3">
        <div class="flex items-center gap-2 px-1">
          <Button size="small" variant="ghost" onClick={up} disabled={roots() || !cwd()}>
            {language.t("dialog.directory.action.up")}
          </Button>
          <Button size="small" variant="ghost" onClick={add} disabled={!cwd() || !!edit()}>
            {language.t("dialog.directory.action.newFolder")}
          </Button>
          <Button
            size="small"
            variant="ghost"
            onClick={rename}
            disabled={
              !cwd() ||
              !!edit() ||
              /^[A-Za-z]:\/$/.test(normalizeDriveRoot(cwd())) ||
              trimTrailing(cwd()) === "/" ||
              trimTrailing(cwd()) === "//"
            }
          >
            {language.t("common.rename")}
          </Button>
          <Button
            size="small"
            variant="ghost"
            onClick={remove}
            disabled={
              !cwd() ||
              !!edit() ||
              /^[A-Za-z]:\/$/.test(normalizeDriveRoot(cwd())) ||
              trimTrailing(cwd()) === "/" ||
              trimTrailing(cwd()) === "//"
            }
          >
            {language.t("common.delete")}
          </Button>
          <Show when={roots()}>
            <div class="ml-auto text-12-regular text-text-weak truncate">{language.t("dialog.directory.roots")}</div>
          </Show>
        </div>
        <Show when={!roots() && !!cwd()}>
          <div class="px-1 -mt-1 flex items-center gap-1 overflow-x-auto whitespace-nowrap">
            <For each={crumb(cwd())}>
              {(item) => (
                <button
                  type="button"
                  class="text-12-regular text-text-weak hover:text-text-strong transition-colors"
                  onClick={() => go(item.path)}
                >
                  {item.name}
                </button>
              )}
            </For>
          </div>
        </Show>
        <Show when={!!edit()}>
          <div
            class="absolute inset-0 z-20 flex items-center justify-center bg-black/30 px-4"
            onClick={() => setEdit("")}
          >
            <form
              class="w-full max-w-[460px] rounded-xl border border-border-weak-base bg-surface-raised-stronger-non-alpha shadow-xl p-4 flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault()
                void save()
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div class="text-14-medium text-text-strong">
                {edit() === "new" ? language.t("dialog.directory.action.newFolder") : language.t("common.rename")}
              </div>
              <TextField
                autofocus={platform.platform !== "mobile"}
                value={draft()}
                onChange={setDraft}
                placeholder={
                  edit() === "new" ? language.t("dialog.directory.prompt.newFolder") : language.t("common.rename")
                }
              />
              <div class="flex justify-end gap-2">
                <Button size="small" variant="secondary" type="button" onClick={() => setEdit("")}>
                  {language.t("common.cancel")}
                </Button>
                <Button size="small" type="submit">
                  {language.t("common.save")}
                </Button>
              </div>
            </form>
          </div>
        </Show>
        <List
          class="flex-1 min-h-0"
          search={{
            placeholder: language.t("dialog.directory.search.placeholder"),
            autofocus: platform.platform !== "mobile",
          }}
          emptyMessage={language.t("dialog.directory.empty")}
          loadingMessage={language.t("common.loading")}
          items={items}
          key={(x) => x.absolute}
          filterKeys={["search"]}
          groupBy={(item) => item.group}
          sortGroupsBy={(a, b) => {
            if (a.category === b.category) return 0
            return a.category === "recent" ? -1 : 1
          }}
          groupHeader={(group) =>
            group.category === "recent" ? language.t("home.recentProjects") : language.t("command.project.open")
          }
          ref={(r) => (list = r)}
          onFilter={(value) => setFilter(cleanInput(value))}
          onMove={(item) => setFocus(item?.absolute ?? "")}
          onKeyEvent={(e, item) => {
            if (e.key === "Backspace" && !cleanInput(filter())) {
              e.preventDefault()
              up()
              return
            }
            if (e.key !== "Tab") return
            if (e.shiftKey) return
            if (!item) return

            e.preventDefault()
            e.stopPropagation()

            const value = displayPath(item.absolute, filter(), home())
            list?.setFilter(value.endsWith("/") ? value : value + "/")
          }}
          onSelect={(path) => {
            if (!path) return
            setFocus(path.absolute)
            if (path.group === "folders") {
              go(path.absolute)
              return
            }
            resolve(path.absolute)
          }}
        >
          {(item) => {
            const path = displayPath(item.absolute, filter(), home())
            if (path === "~") {
              return (
                <div class="w-full flex items-center justify-between rounded-md">
                  <div class="flex items-center gap-x-3 grow min-w-0">
                    <FileIcon node={{ path: item.absolute, type: "directory" }} class="shrink-0 size-4" />
                    <div class="flex items-center text-14-regular min-w-0">
                      <span class="text-text-strong whitespace-nowrap">~</span>
                      <span class="text-text-weak whitespace-nowrap">/</span>
                    </div>
                  </div>
                </div>
              )
            }
            if (/^[A-Za-z]:$/.test(path) || /^\/[A-Za-z]:$/.test(path)) {
              const root = path.startsWith("/") ? path.slice(1) : path
              return (
                <div class="w-full flex items-center justify-between rounded-md">
                  <div class="flex items-center gap-x-3 grow min-w-0">
                    <FileIcon node={{ path: item.absolute, type: "directory" }} class="shrink-0 size-4" />
                    <div class="flex items-center text-14-regular min-w-0">
                      <span class="text-text-strong whitespace-nowrap">{root}</span>
                      <span class="text-text-weak whitespace-nowrap">/</span>
                    </div>
                  </div>
                </div>
              )
            }
            return (
              <div class="w-full flex items-center justify-between rounded-md">
                <div class="flex items-center gap-x-3 grow min-w-0">
                  <FileIcon node={{ path: item.absolute, type: "directory" }} class="shrink-0 size-4" />
                  <div class="flex items-center text-14-regular min-w-0">
                    <span class="text-text-weak whitespace-nowrap overflow-hidden overflow-ellipsis truncate min-w-0">
                      {getDirectory(path)}
                    </span>
                    <span class="text-text-strong whitespace-nowrap">{getFilename(path)}</span>
                    <span class="text-text-weak whitespace-nowrap">/</span>
                  </div>
                </div>
              </div>
            )
          }}
        </List>
        <div class="mt-2 pt-3 pb-3 px-3 border-t border-border-weak-base flex justify-end gap-2">
          <Button size="small" variant="secondary" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button size="small" onClick={openFolder} disabled={!canOpen()}>
            {language.t("common.open")}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
