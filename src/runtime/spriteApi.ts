import { SpriteModel } from './spriteModel'
import { World } from './world'
import { touchingSprites, touchingEdge, distanceBetween } from './sensing'
import { FriendlyError, expectNumber } from './errors'

function resolveTarget(
  fn: string,
  world: World,
  self: SpriteModel,
  target: unknown,
): { x: number; y: number } {
  if (target === 'mouse') return world.mouse
  if (typeof target === 'object' && target !== null && 'x' in target && 'y' in target) {
    return target as { x: number; y: number }
  }
  if (typeof target === 'string') {
    const found = world.sprites.find(s => s.name === target && s !== self && !s.deleted)
    if (found) return found
  }
  const names = [...new Set(world.sprites.filter(s => s !== self).map(s => `"${s.name}"`))]
  throw new FriendlyError(
    `\`${fn}\` couldn't find "${String(target)}". Try "mouse" or a sprite name: ${names.join(', ')}.`,
  )
}

export function makeSpriteApi(model: SpriteModel, world: World) {
  return {
    get name() { return model.name },
    get x() { return model.x },
    get y() { return model.y },
    get direction() { return model.direction },
    get size() { return model.size },

    // motion
    move: (steps: unknown) => model.move(steps),
    turnRight: (deg: unknown) => model.turnRight(deg),
    turnLeft: (deg: unknown) => model.turnLeft(deg),
    goTo: (x: unknown, y: unknown) => model.goTo(x, y),
    changeX: (n: unknown) => model.changeX(n),
    changeY: (n: unknown) => model.changeY(n),
    glide: (x: unknown, y: unknown, secs: unknown) => model.glide(x, y, secs),
    pointInDirection: (deg: unknown) => model.pointInDirection(deg),
    pointTowards: (target: unknown) =>
      model.pointTowards(resolveTarget('pointTowards', world, model, target)),
    setRotationStyle: (style: unknown) => model.setRotationStyle(style),
    ifOnEdgeBounce: () => model.ifOnEdgeBounce(),

    // looks
    say: (text: unknown, secs?: unknown) => model.say(text, secs),
    think: (text: unknown, secs?: unknown) => model.think(text, secs),
    switchCostume: (name: unknown) => model.switchCostume(name),
    nextCostume: () => model.nextCostume(),
    setSize: (percent: unknown) => model.setSize(percent),
    show: () => model.show(),
    hide: () => model.hide(),
    setEffect: (name: unknown, value: unknown) => model.setEffect(name, value),
    clearEffects: () => model.clearEffects(),
    goToFront: () => world.goToFront(model),
    goBack: (n: unknown) =>
      world.goBack(model, Math.max(0, expectNumber('goBack', 'sprite.goBack(1)', n))),

    // sensing
    touching: (target: unknown): boolean => {
      if (target === 'edge') return touchingEdge(model)
      if (typeof target === 'string') {
        const others = world.sprites.filter(
          s => s.name === target && s !== model && !s.deleted,
        )
        if (others.length === 0) {
          // No clones of this sprite exist yet — that's not an error, just "not touching".
          if (target === model.name) return false
          const names = [...new Set(world.sprites.map(s => `"${s.name}"`))]
          throw new FriendlyError(
            `\`touching\` couldn't find "${target}". Try "edge"${names.length ? ` or a sprite name: ${names.join(', ')}` : ''}.`,
          )
        }
        return others.some(o => touchingSprites(model, o))
      }
      throw new FriendlyError(
        `\`touching\` needs "edge" or a sprite name in quotes, like \`sprite.touching("Bat")\`.`,
      )
    },
    distanceTo: (target: unknown): number =>
      distanceBetween(model, resolveTarget('distanceTo', world, model, target)),

    // control
    clone: () => world.clone(model),
    deleteClone: () => world.removeClone(model),
  }
}

export type SpriteApi = ReturnType<typeof makeSpriteApi>
