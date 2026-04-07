declare module "@hono/node-ws" {
  import type { Hono } from "hono"
  import type { UpgradeWebSocket } from "hono/ws"

  export function createNodeWebSocket(opts: { app: Hono }): {
    injectWebSocket(server: unknown): void
    upgradeWebSocket: UpgradeWebSocket
  }
}
