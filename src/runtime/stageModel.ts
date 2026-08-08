import { FriendlyError, expectString } from './errors'
import type { Costume } from './spriteModel'

export class StageModel {
  currentBackdrop = 0
  onBackdropChange: ((name: string) => void) | null = null

  constructor(public backdrops: Costume[]) {}

  switchBackdrop(name: unknown): void {
    const n = expectString('switchBackdrop', 'stage.switchBackdrop("blue-sky")', name)
    const idx = this.backdrops.findIndex(b => b.name === n)
    if (idx === -1) {
      const names = this.backdrops.map(b => `"${b.name}"`).join(', ')
      throw new FriendlyError(
        `\`switchBackdrop\` couldn't find a backdrop called "${n}". The backdrops are: ${names}.`,
      )
    }
    this.currentBackdrop = idx
    this.onBackdropChange?.(n)
  }

  nextBackdrop(): void {
    this.currentBackdrop = (this.currentBackdrop + 1) % this.backdrops.length
    this.onBackdropChange?.(this.backdrops[this.currentBackdrop].name)
  }
}
