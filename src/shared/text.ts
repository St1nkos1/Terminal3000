// Имя последней папки пути в любом виде: C:\a\b, C:/a/b/
export function folderName(cwd: string): string {
  const parts = cwd.split(/[\\/]+/).filter(Boolean)
  return parts.length > 0 ? parts[parts.length - 1] : cwd
}

// Ключ для сравнения путей Windows: регистр и вид слэшей не важны
export function cwdKey(cwd: string): string {
  return cwd.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

export function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}
