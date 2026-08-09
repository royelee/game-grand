import Phaser from 'phaser'
import { STAGE_WIDTH, STAGE_HEIGHT } from '../runtime/spriteModel'
import { RuntimeSession } from './session'
import { reconcile, toStageX, toStageY, type SpriteView } from './spriteViews'
import { keyName } from './keys'
import { buildTextureIndex, type TextureIndex } from './textureKeys'
import { PenLayerView } from './penLayer'
import type { RunPayload } from '../shared/protocol'

interface SpriteEntry {
  image: Phaser.GameObjects.Image
  bubble: Phaser.GameObjects.Container | null
  bubbleText: string | null
}

export class StageScene extends Phaser.Scene {
  private entries = new Map<number, SpriteEntry>()
  private backdrop: Phaser.GameObjects.Image | null = null
  private pen: PenLayerView | null = null
  private watchText: Phaser.GameObjects.Text | null = null
  private audio = new Map<string, string>()
  private playing = new Set<HTMLAudioElement>()
  // A costume name is only unique per sprite, so an uploaded costume can
  // collide with a library one of the same name; textures are keyed by
  // content (dataUrl) instead, and this resolves a snapshot's costume name
  // back to the right key. Built once from the payload — clones share their
  // original's name, so this mapping (which only knows originals) still
  // resolves for them.
  private textureIndex: TextureIndex
  // sprite id -> sprite name, refreshed every render from the live snapshot
  // (SpriteView itself is deliberately name-agnostic — see spriteViews.ts).
  private idToName = new Map<number, string>()

  constructor(
    private session: RuntimeSession,
    private payload: RunPayload,
  ) {
    super('stage')
    this.textureIndex = buildTextureIndex(payload)
  }

  preload(): void {
    for (const s of this.payload.sprites) {
      for (const c of s.costumes) {
        const key = this.textureIndex.bySprite.get(s.name)?.get(c.name)
        if (key && !this.textures.exists(key)) this.load.image(key, c.dataUrl)
      }
    }
    for (const b of this.payload.backdrops) {
      const key = this.textureIndex.byBackdrop.get(b.name)
      if (key && !this.textures.exists(key)) this.load.image(key, b.dataUrl)
    }
    for (const [name, dataUrl] of this.textureIndex.bySound) this.audio.set(name, dataUrl)
  }

  create(): void {
    const startName = this.payload.backdrops[this.payload.currentBackdrop]?.name ?? ''
    this.backdrop = this.add
      .image(STAGE_WIDTH / 2, STAGE_HEIGHT / 2, this.textureIndex.byBackdrop.get(startName) ?? '')
      .setDepth(-1000)
      .setDisplaySize(STAGE_WIDTH, STAGE_HEIGHT)

    this.pen = new PenLayerView(this)

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
    this.idToName = new Map(snap.sprites.map(s => [s.id, s.name]))
    const { create, update, destroy } = reconcile(new Set(this.entries.keys()), snap)

    for (const id of create) {
      const view = update.find(v => v.id === id)!
      const image = this.add.image(view.px, view.py, this.resolveTexture(view) ?? '')
      this.entries.set(id, { image, bubble: null, bubbleText: null })
    }
    for (const id of destroy) {
      const entry = this.entries.get(id)
      entry?.image.destroy()
      entry?.bubble?.destroy()
      this.entries.delete(id)
    }
    for (const view of update) this.applyView(view)

    // After the sprite images are positioned: a stamp copies an image as this
    // very snapshot describes it, so it must not run against last frame's pose.
    this.pen?.apply(
      snap.penOps,
      (name, costume) =>
        (costume && this.textureIndex.bySprite.get(name)?.get(costume)) ?? null,
    )

    // The snapshot names a backdrop; Phaser needs its texture key. Going
    // straight from name to key would re-introduce the collision buildTextureIndex
    // exists to prevent, for every switchBackdrop at runtime.
    const wanted = snap.backdrop ? this.textureIndex.byBackdrop.get(snap.backdrop) : null
    if (this.backdrop && wanted && this.backdrop.texture.key !== wanted) {
      this.backdrop.setTexture(wanted).setDisplaySize(STAGE_WIDTH, STAGE_HEIGHT)
    }
    if (this.watchText) {
      this.watchText.setText(snap.watches.map(w => `${w.name}: ${w.value}`).join('\n'))
    }
    for (const sound of snap.sounds) this.playSound(sound.id, sound.name)
  }

  /** Resolve a view's costume name to its unique texture key via the sprite it belongs to. */
  private resolveTexture(view: SpriteView): string | null {
    if (!view.texture) return null
    const spriteName = this.idToName.get(view.id)
    if (!spriteName) return null
    return this.textureIndex.bySprite.get(spriteName)?.get(view.texture) ?? null
  }

  private applyView(view: SpriteView): void {
    const entry = this.entries.get(view.id)
    if (!entry) return
    const { image } = entry
    const texture = this.resolveTexture(view)
    if (texture && image.texture.key !== texture) image.setTexture(texture)
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
