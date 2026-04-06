let nav: ((href: string) => void) | undefined
let pending: string | undefined

export const setNavigate = (fn?: (href: string) => void) => {
  nav = fn
  if (!nav) return
  if (!pending) return
  const href = pending
  pending = undefined
  nav(href)
}

export const handleNotificationClick = (href?: string) => {
  window.focus()
  if (!href) return
  if (nav) return nav(href)
  pending = href
}
