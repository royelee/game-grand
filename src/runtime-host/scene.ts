import Phaser from 'phaser'
import { STAGE_WIDTH, STAGE_HEIGHT } from '../runtime/spriteModel'
import { RuntimeSession } from './session'
import { reconcile, toStageX, toStageY, type SpriteView } from './spriteViews'
import { keyName } from './keys'
import type { RunPayload } from '../shared/protocol'

interface SpriteEntry {
  image: Phaser.GameObjects.Image
  bubble: Phaser.GameObjects.Container | null
  bubbleText: string | null
}

export class StageScene extends Phaser.Scene {
  private entries = new Map<number, SpriteEntry>()
  private backdrop: Phaser.GameObjects.Image | null = null
  private watchText: Phaser.GameObjects.Text | null = null
  private audio = new Map<string, string>()
  private playing = new Set<HTMLAudioElement>()

  constructor(
    private session: RuntimeSession,
    private payload: RunPayload,
  ) {
    super('stage')
  }

  preload(): void {
    for (const s of this.payload.sprites) {
      for (const c of s.costumes) {
        if (!this.textures.exists(c.name)) this.load.image(c.name, c.dataUrl)
      }
    }
    for (const b of this.payload.backdrops) {
      if (!this.textures.exists(b.name)) this.load.image(b.name, b.dataUrl)
    }
    for (const s of this.payload.sounds) this.audio.set(s.name, s.dataUrl)
  }

  create(): void {
    this.backdrop = this.add
      .image(STAGE_WIDTH / 2, STAGE_HEIGHT / 2, this.payload.backdrops[this.payload.currentBackdrop]?.name ?? '')
      .setDepth(-1000)
      .setDisplaySize(STAGE_WIDTH, STAGE_HEIGHT)

    this.watchText = this.add
      .text(6, 6, '', { fontFamily: 'system-ui, sans-serif', fontSize: '13px', color: '#1a1a1a', backgroundColor: '#ffffffcc' })
      .setDepth(10000)

    this.input.on('pointermove', (p: Phaser.Input.Pointer) =>
      this.session.mouseMove(toStageX(p.x), toStageY(p.y)),
    )
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      this.session.mouseDown(toStageX(p.x), toStageY(p.y))
      this.session.clickAt(toStageX(p.x), toStageY(p.y))
    })
    this.input.on('pointerup', () => this.session.mouseUp())
    this.input.keyboard?.on('keydown', (e: KeyboardEvent) => this.session.keyDown(keyName(e.key)))
    this.input.keyboard?.on('keyup', (e: KeyboardEvent) => this.session.keyUp(keyName(e.key)))

    this.session.start()
    this.render()
  }

  update(_time: number, deltaMs: number): void {
    this.session.step(deltaMs / 1000)
    this.render()
  }

  private render(): void {
    const snap = this.session.snapshot()
    const { create, update, destroy } = reconcile(new Set(this.entries.keys()), snap)

    for (const id of create) {
      const view = update.find(v => v.id === id)!
      const image = this.add.image(view.px, view.py, view.texture ?? '')
      this.entries.set(id, { image, bubble: null, bubbleText: null })
    }
    for (const id of destroy) {
      const entry = this.entries.get(id)
      entry?.image.destroy()
      entry?.bubble?.destroy()
      this.entries.delete(id)
    }
    for (const view of update) this.applyView(view)

    if (this.backdrop && snap.backdrop && this.backdrop.texture.key !== snap.backdrop) {
      this.backdrop.setTexture(snap.backdrop).setDisplaySize(STAGE_WIDTH, STAGE_HEIGHT)
    }
    if (this.watchText) {
      this.watchText.setText(snap.watches.map(w => `${w.name}: ${w.value}`).join('\n'))
    }
    for (const sound of snap.sounds) this.playSound(sound.id, sound.name)
  }

  private applyView(view: SpriteView): void {
    const entry = this.entries.get(view.id)
    if (!entry) return
    const { image } = entry
    if (view.texture && image.texture.key !== view.texture) image.setTexture(view.texture)
    image.setPosition(view.px, view.py)
    image.setAngle(view.angle)
    image.setScale(view.scale)
    image.setAlpha(view.alpha)
    image.setFlipX(view.flipX)
    image.setDepth(view.depth)
    this.applyBubble(entry, view)
  }

  private applyBubble(entry: SpriteEntry, view: SpriteView): void {
    const wanted = view.bubble && view.alpha > 0 ? view.bubble.text : null
    if (wanted === null) {
      entry.bubble?.destroy()
      entry.bubble = null
      entry.bubbleText = null
      return
    }
    if (entry.bubbleText !== wanted) {
      entry.bubble?.destroy()
      const text = this.add.text(0, 0, wanted, {
        fontFamily: 'system-ui, sans-serif', fontSize: '14px', color: '#1a1a1a',
        wordWrap: { width: 160 },
      })
      const pad = 6
      const bg = this.add.graphics()
      bg.fillStyle(0xffffff, 0.95)
      bg.lineStyle(1, 0xb0b0b0, 1)
      bg.fillRoundedRect(-pad, -pad, text.width + pad * 2, text.height + pad * 2, 8)
      bg.strokeRoundedRect(-pad, -pad, text.width + pad * 2, text.height + pad * 2, 8)
      const container = this.add.container(0, 0, [bg, text])
      entry.bubble = container
      entry.bubbleText = wanted
    }
    const halfH = (entry.image.displayHeight || 0) / 2
    entry.bubble!.setPosition(view.px + 12, view.py - halfH - 34).setDepth(view.depth + 500)
  }

  private playSound(id: number, name: string): void {
    const url = this.audio.get(name)
    if (!url) return
    const el = new Audio(url)
    el.volume = Math.min(1, Math.max(0, this.session.world.volume / 100))
    this.playing.add(el)
    el.addEventListener('ended', () => {
      this.playing.delete(el)
      this.session.world.soundFinished(id)
    })
    void el.play().catch(() => {
      this.playing.delete(el)
      this.session.world.soundFinished(id)
    })
  }

  /** Silence anything still playing — a run must not outlive its stage. */
  stopSounds(): void {
    for (const el of this.playing) {
      el.pause()
      el.currentTime = 0
    }
    this.playing.clear()
  }
}
