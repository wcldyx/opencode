import {
  createContext,
  createEffect,
  createRoot,
  createSignal,
  getOwner,
  onCleanup,
  type Owner,
  type ParentProps,
  runWithOwner,
  useContext,
  type JSX,
} from "solid-js"
import { Dialog as Kobalte } from "@kobalte/core/dialog"
import { makeEventListener } from "@solid-primitives/event-listener"

type DialogElement = () => JSX.Element

type Active = {
  id: string
  node: JSX.Element
  dispose: () => void
  owner: Owner
  onClose?: () => void
  setClosing: (closing: boolean) => void
}

const Context = createContext<ReturnType<typeof init>>()

function init() {
  const [stack, setStack] = createSignal<Active[]>([])
  const timers = new Map<string, ReturnType<typeof setTimeout>>()

  onCleanup(() => {
    for (const timer of timers.values()) clearTimeout(timer)
    timers.clear()
  })

  const close = () => {
    const cur = stack().at(-1)
    if (!cur) return
    if (timers.has(cur.id)) return
    cur.onClose?.()
    cur.setClosing(true)

    const id = cur.id
    const timer = setTimeout(() => {
      timers.delete(id)
      cur.dispose()
      setStack((list) => list.filter((item) => item.id !== id))
    }, 100)
    timers.set(id, timer)
  }

  createEffect(() => {
    if (stack().length === 0) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      close()
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
    }

    const onBack = (event: Event) => {
      close()
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
    }

    makeEventListener(window, "keydown", onKeyDown, { capture: true })
    makeEventListener(window, "opencode:back", onBack, { capture: true })
  })

  const show = (element: DialogElement, owner: Owner, onClose?: () => void) => {
    const id = Math.random().toString(36).slice(2)
    let dispose: (() => void) | undefined
    let setClosing: ((closing: boolean) => void) | undefined

    const node = runWithOwner(owner, () =>
      createRoot((d: () => void) => {
        dispose = d
        const [closing, setClosingSignal] = createSignal(false)
        setClosing = setClosingSignal
        return (
          <Kobalte
            modal
            open={!closing()}
            onOpenChange={(open: boolean) => {
              if (open) return
              close()
            }}
          >
            <Kobalte.Portal>
              <Kobalte.Overlay data-component="dialog-overlay" onClick={close} />
              {element()}
            </Kobalte.Portal>
          </Kobalte>
        )
      }),
    )

    if (!dispose || !setClosing) return
    const d = dispose
    const set = setClosing

    setStack((list) => [...list, { id, node, dispose: d, owner, onClose, setClosing: set }])
  }

  return {
    get stack() {
      return stack()
    },
    get active() {
      return stack().at(-1)
    },
    close,
    show,
  }
}

export function DialogProvider(props: ParentProps) {
  const ctx = init()
  return (
    <Context.Provider value={ctx}>
      {props.children}
      <div data-component="dialog-stack">{ctx.stack.map((item) => item.node)}</div>
    </Context.Provider>
  )
}

export function useDialog() {
  const ctx = useContext(Context)
  const owner = getOwner()

  if (!owner) {
    throw new Error("useDialog must be used within a DialogProvider")
  }
  if (!ctx) {
    throw new Error("useDialog must be used within a DialogProvider")
  }

  return {
    get active() {
      return ctx.active
    },
    show(element: DialogElement, onClose?: () => void) {
      const base = ctx.active?.owner ?? owner
      ctx.show(element, base, onClose)
    },
    close() {
      ctx.close()
    },
  }
}
