// Проверяет, что node-pty грузится в рантайме Electron без пересборки.
// Запуск: npm run check:pty
if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process')
  const electronPath = require('electron')
  const r = spawnSync(electronPath, [__filename], {
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  })
  process.exit(r.status ?? 1)
}

const pty = require('node-pty')
const p = pty.spawn('cmd.exe', ['/c', 'echo pty-ok'], { cols: 80, rows: 24, useConptyDll: true })
let out = ''
const timer = setTimeout(() => {
  console.error('node-pty: нет ответа за 10 с')
  process.exit(1)
}, 10000)
p.onData((d) => {
  out += d
})
p.onExit(({ exitCode }) => {
  setTimeout(() => {
    clearTimeout(timer)
    const ok = out.includes('pty-ok') && exitCode === 0
    console.log(ok ? `node-pty OK (Electron ${process.versions.electron})` : 'node-pty: нет вывода')
    process.exit(ok ? 0 : 1)
  }, 200)
})
