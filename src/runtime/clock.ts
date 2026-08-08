type FrameCb = (dt: number) => void

export class Clock {
  private time = 0
  private frameCbs = new Set<FrameCb>()
  private waits: { due: number; resolve: () => void }[] = []

  get now(): number {
    return this.time
  }

  tick(dt: number): void {
    this.time += dt
    for (const cb of [...this.frameCbs]) cb(dt)
    const due = this.waits.filter(w => w.due <= this.time)
    this.waits = this.waits.filter(w => w.due > this.time)
    for (const w of due) w.resolve()
  }

  wait(secs: number): Promise<void> {
    return new Promise(resolve => {
      this.waits.push({ due: this.time + secs, resolve })
    })
  }

  onFrame(cb: FrameCb): () => void {
    this.frameCbs.add(cb)
    return () => this.frameCbs.delete(cb)
  }

  clearAll(): void {
    this.frameCbs.clear()
    this.waits = []
  }
}
