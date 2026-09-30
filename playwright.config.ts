import { defineConfig } from '@playwright/test'

// trace/screenshot/video выключены: в них может попасть содержимое терминала
export default defineConfig({
  testDir: 'tests/e2e',
  workers: 1,
  timeout: 90000,
  use: { trace: 'off', screenshot: 'off', video: 'off' }
})
