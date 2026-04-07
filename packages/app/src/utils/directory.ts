export const directoryKey = (directory: string) => {
  const value = directory.replaceAll("\\", "/")
  const drive = value.match(/^([A-Za-z]:)\/+$/)
  if (drive) return `${drive[1].toUpperCase()}/`
  if (/^\/+$/i.test(value)) return "/"

  const next = value.replace(/\/+$/, "")
  const path = next.match(/^([A-Za-z]):(\/.*)?$/)
  if (path) return `${path[1].toUpperCase()}:${path[2] ?? ""}`
  return next
}

export const normalizeDirectory = directoryKey

export const sameDirectory = (a: string, b: string) => {
  return directoryKey(a) === directoryKey(b)
}

function isWindowsDir(dir: string) {
  return /^[A-Za-z]:[\\/]/.test(dir)
}

export const directoryAliases = (dir: string) => {
  if (!isWindowsDir(dir)) return [dir]

  const alt = dir.includes("\\") ? dir.replaceAll("\\", "/") : dir.replaceAll("/", "\\")
  if (alt === dir) return [dir]
  return [dir, alt]
}
