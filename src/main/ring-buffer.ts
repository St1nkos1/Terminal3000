// Последние maxChars символов вывода вкладки. Только в памяти, на диск не пишется.
export class RingBuffer {
  private chunks: string[] = []
  private size = 0

  constructor(private readonly maxChars: number) {}

  push(data: string): void {
    if (!data) return
    this.chunks.push(data)
    this.size += data.length
    // мелкие чанки склеиваются, чтобы обрезка начала не стала квадратичной
    if (this.chunks.length > 512) this.chunks = [this.chunks.join('')]
    while (this.size > this.maxChars) {
      const over = this.size - this.maxChars
      const first = this.chunks[0]
      if (first.length <= over) {
        this.chunks.shift()
        this.size -= first.length
        continue
      }
      let cut = over
      // не начинать с половины суррогатной пары
      const c = first.charCodeAt(cut)
      if (c >= 0xdc00 && c <= 0xdfff) cut++
      this.chunks[0] = first.slice(cut)
      this.size -= cut
    }
  }

  text(): string {
    if (this.chunks.length > 1) this.chunks = [this.chunks.join('')]
    return this.chunks[0] ?? ''
  }
}
