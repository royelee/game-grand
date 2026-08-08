export type Handler = (...args: unknown[]) => unknown

export class EventBus {
  private handlers = new Map<string, Handler[]>()
  onError: (err: unknown) => void = () => {}

  register(event: string, handler: Handler): void {
    const list = this.handlers.get(event) ?? []
    list.push(handler)
    this.handlers.set(event, list)
  }

  fire(event: string, ...args: unknown[]): void {
    for (const h of this.handlers.get(event) ?? []) {
      try {
        const r = h(...args)
        if (r instanceof Promise) r.catch(err => this.onError(err))
      } catch (err) {
        this.onError(err)
      }
    }
  }

  clear(): void {
    this.handlers.clear()
  }
}
