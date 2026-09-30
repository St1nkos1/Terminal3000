import { defineConfig } from 'electron-vite'

// Входы по умолчанию: src/main/index.ts, src/preload/index.ts, src/renderer/index.html.
// Зависимости из "dependencies" (node-pty) electron-vite 5 выносит из бандла сам.
export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    // plugin-react не подходит к vite 7, JSX собирает esbuild
    esbuild: { jsx: 'automatic' }
  }
})
