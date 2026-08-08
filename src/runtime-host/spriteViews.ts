import { STAGE_WIDTH, STAGE_HEIGHT } from '../runtime/spriteModel'

type SnapshotSprite = ReturnType<
  import('../runtime/world').World['snapshot']
>['sprites'][number]

export interface SpriteView {
  id: number
  px: number
  py: number
  angle: number
  scale: number
  alpha: number
  flipX: boolean
  depth: number
  texture: string | null
  bubble: { text: string; kind: 'say' | 'think' } | null
}

export const toPhaserX = (x: number): number => STAGE_WIDTH / 2 + x
export const toPhaserY = (y: number): number => STAGE_HEIGHT / 2 - y
export const toStageX = (px: number): number => px - STAGE_WIDTH / 2
export const toStageY = (py: number): number => STAGE_HEIGHT / 2 - py

/** Everything the scene needs, already in Phaser's coordinate space. */
export function viewFor(s: SnapshotSprite, depth: number): SpriteView {
  const ghost = s.effects.ghost ?? 0
  const alpha = s.visible ? Math.min(1, Math.max(0, 1 - ghost / 100)) : 0
  const leftRight = s.rotationStyle === 'left-right'
  return {
    id: s.id,
    px: toPhaserX(s.x),
    py: toPhaserY(s.y),
    angle: s.rotationStyle === 'all around' ? s.direction - 90 : 0,
    scale: s.size / 100,
    alpha,
    flipX: leftRight && s.direction < 0,
    depth,
    texture: s.costume,
    bubble: s.bubble,
  }
}

export function reconcile(
  prevIds: Set<number>,
  snapshot: { sprites: SnapshotSprite[] },
): { create: number[]; update: SpriteView[]; destroy: number[]; order: number[] } {
  const update = snapshot.sprites.map((s, i) => viewFor(s, i))
  const liveIds = new Set(update.map(v => v.id))
  return {
    create: update.filter(v => !prevIds.has(v.id)).map(v => v.id),
    update,
    destroy: [...prevIds].filter(id => !liveIds.has(id)),
    order: update.map(v => v.id),
  }
}
