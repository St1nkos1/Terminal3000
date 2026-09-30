import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    environment: 'node',
    // node-pty — нативный модуль, в отдельных процессах он надёжнее, чем в worker_threads
    pool: 'forks',
    testTimeout: 15000
  }
})
