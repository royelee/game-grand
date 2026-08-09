import Phaser from 'phaser'
import { STAGE_WIDTH, STAGE_HEIGHT } from '../runtime/spriteModel'
import type { PenOp } from '../runtime/pen'
import { batchOps, type PenStroke } from './penBatch'

/** Above the backdrop (-1000), below every sprite (depths start at 0). */
export const PEN_DEPTH = -500

export class PenLayerView {
  private texture: Phaser.GameObjects.RenderTexture
  private brush: Phaser.GameObjects.Graphics
  private stampImage: Phaser.GameObjects.Image

  constructor(scene: Phaser.Scene) {
    this.texture = scene.add
      .renderTexture(0, 0, STAGE_WIDTH, STAGE_HEIGHT)
      .setOrigin(0, 0)
      .setDepth(PEN_DEPTH)
    // Neither of these is added to the display list: they exist only to be
    // stamped into the render texture, and a visible copy of either would
    // double what the stage shows.
    this.brush = scene.make.graphics({}, false)
    this.stampImage = scene.make.image({}, false)
  }

  apply(
    ops: PenOp[],
    textureKeyFor: (spriteName: string, costume: string | null) => string | null,
  ): void {
    if (ops.length === 0) return

    for (const draw of batchOps(ops)) {
      if (draw.kind === 'clear') {
        this.texture.clear()
        continue
      }
      if (draw.kind === 'stamp') {
        const key = textureKeyFor(draw.name, draw.view.texture)
        if (!key) continue
        // Posed from the frozen stamp, never from the live sprite: the sprite
        // may already have moved on by the time this frame renders.
        this.stampImage
          .setTexture(key)
          .setPosition(draw.view.px, draw.view.py)
          .setAngle(draw.view.angle)
          .setScale(draw.view.scale)
          .setAlpha(draw.view.alpha)
          .setFlipX(draw.view.flipX)
        this.texture.draw(this.stampImage)
        continue
      }
      this.brush.clear()
      for (const stroke of draw.strokes) this.paint(stroke)
      this.texture.draw(this.brush)
    }
  }

  private paint(stroke: PenStroke): void {
    if (stroke.kind === 'dot') {
      this.brush.fillStyle(stroke.color, stroke.alpha)
      this.brush.fillCircle(stroke.x, stroke.y, Math.max(0.5, stroke.size / 2))
      return
    }
    this.brush.lineStyle(stroke.size, stroke.color, stroke.alpha)
    this.brush.lineBetween(stroke.x1, stroke.y1, stroke.x2, stroke.y2)
    // Graphics strokes are butt-capped, so a chain of thick segments shows a
    // notch at every corner. Rounding the ends by hand is what makes a thick
    // spirograph look drawn rather than assembled.
    if (stroke.size > 2) {
      this.brush.fillStyle(stroke.color, stroke.alpha)
      this.brush.fillCircle(stroke.x1, stroke.y1, stroke.size / 2)
      this.brush.fillCircle(stroke.x2, stroke.y2, stroke.size / 2)
    }
  }

  destroy(): void {
    this.brush.destroy()
    this.stampImage.destroy()
    this.texture.destroy()
  }
}
