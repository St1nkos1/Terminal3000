import type { T3000Api } from '../shared/ipc'

declare global {
  interface Window {
    t3000: T3000Api
  }
}

export {}
