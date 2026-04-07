import { Capacitor } from "@capacitor/core"
import { nativeHttp } from "./bridge-native"

const webFetch = globalThis.fetch.bind(globalThis)

const streamPath = (url: string) => {
  const path = new URL(url).pathname
  return path.endsWith("/event") || path.endsWith("/sync-event")
}

const decode = (chunk: string) => {
  const raw = globalThis.atob(chunk)
  const buf = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i += 1) buf[i] = raw.charCodeAt(i)
  return buf
}

export async function nativeFetch(input: RequestInfo | URL, init?: RequestInit) {
  if (!Capacitor.isNativePlatform()) return webFetch(input, init)

  const req = input instanceof Request ? input : new Request(input, init)

  if (streamPath(req.url)) {
    const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined
    let dead = false
    let off: () => Promise<void> = async () => undefined
    let tail = Promise.resolve()
    const push = (fn: () => void | Promise<void>) => {
      tail = tail.then(fn).catch(() => undefined)
      return tail
    }
    const seal = () => {
      try {
        controller?.close()
      } catch {
        return
      }
    }
    const halt = () => {
      if (dead) return
      dead = true
      void off().finally(() => {
        seal()
        void nativeHttp.abort({ id }).catch(() => undefined)
      })
    }
    const [chunk, done, err] = await Promise.all([
      nativeHttp.addListener("nativeHttpChunk", (x) => {
        if (x.id !== id) return
        void push(() => {
          if (dead) return
          controller?.enqueue(decode(x.chunk))
        })
      }),
      nativeHttp.addListener("nativeHttpDone", async (x) => {
        if (x.id !== id) return
        void push(async () => {
          await close()
        })
      }),
      nativeHttp.addListener("nativeHttpError", async (x) => {
        if (x.id !== id) return
        void push(async () => {
          await fail(new Error(x.message))
        })
      }),
    ])

    off = async () => {
      req.signal.removeEventListener("abort", abort)
      await Promise.all([chunk.remove(), done.remove(), err.remove()]).catch(() => undefined)
    }

    const abort = () => {
      halt()
    }

    const close = async () => {
      if (dead) {
        seal()
        return
      }
      dead = true
      await off()
      controller?.close()
    }

    const fail = async (e: Error) => {
      if (dead) {
        seal()
        return
      }
      dead = true
      await off()
      controller?.error(e)
    }

    const body = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c
      },
      cancel() {
        halt()
      },
    })

    req.signal.addEventListener("abort", abort, { once: true })

    const meta = await nativeHttp
      .stream({
        id,
        url: req.url,
        method: req.method,
        headers: Object.fromEntries(req.headers.entries()),
        body: req.method === "GET" || req.method === "HEAD" ? undefined : await req.clone().text(),
      })
      .catch(async (e) => {
        await off()
        throw e
      })

    const headers = new Headers()
    Object.entries(meta.headers ?? {}).forEach(([key, value]) => {
      headers.set(key, value)
    })

    const empty = req.method === "HEAD" || [101, 103, 204, 205, 304].includes(meta.status)
    if (empty) {
      await off()
      return new Response(null, { status: meta.status, headers })
    }

    return new Response(body, { status: meta.status, headers })
  }

  const res = await nativeHttp.request({
    url: req.url,
    method: req.method,
    headers: Object.fromEntries(req.headers.entries()),
    body: req.method === "GET" || req.method === "HEAD" ? undefined : await req.clone().text(),
  })

  const headers = new Headers()
  Object.entries(res.headers ?? {}).forEach(([key, value]) => {
    if (typeof value !== "string") return
    headers.set(key, value)
  })

  const empty = req.method === "HEAD" || [101, 103, 204, 205, 304].includes(res.status)
  if (empty) {
    return new Response(null, {
      status: res.status,
      headers,
    })
  }

  const body = typeof res.data === "string" ? res.data : JSON.stringify(res.data ?? null)
  return new Response(body, {
    status: res.status,
    headers,
  })
}
