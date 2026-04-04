import { defineConfig } from "vite"
import base from "../app/vite.js"

export default defineConfig({
  plugins: base as any,
  build: {
    target: "esnext",
  },
})
