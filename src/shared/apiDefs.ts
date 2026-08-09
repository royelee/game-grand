export type ApiCategory =
  | 'Motion' | 'Looks' | 'Pen' | 'Sound' | 'Events' | 'Sensing' | 'Control' | 'Stage' | 'Variables'

export interface ApiDef {
  category: ApiCategory
  name: string
  signature: string
  description: string
  example: string
  scope: 'sprite' | 'global'
}

export const API_DEFS: ApiDef[] = [
  // Motion
  { category: 'Motion', scope: 'sprite', name: 'move', signature: 'sprite.move(steps)', description: 'Walk forward in the direction the sprite is facing.', example: 'sprite.move(10)' },
  { category: 'Motion', scope: 'sprite', name: 'turnRight', signature: 'sprite.turnRight(degrees)', description: 'Turn clockwise by this many degrees.', example: 'sprite.turnRight(15)' },
  { category: 'Motion', scope: 'sprite', name: 'turnLeft', signature: 'sprite.turnLeft(degrees)', description: 'Turn counter-clockwise by this many degrees.', example: 'sprite.turnLeft(15)' },
  { category: 'Motion', scope: 'sprite', name: 'goTo', signature: 'sprite.goTo(x, y)', description: 'Jump straight to a spot. (0, 0) is the middle of the stage.', example: 'sprite.goTo(0, 0)' },
  { category: 'Motion', scope: 'sprite', name: 'glide', signature: 'await sprite.glide(x, y, seconds)', description: 'Slide smoothly to a spot. Use await so the next line waits for the slide to finish.', example: 'await sprite.glide(100, 100, 1)' },
  { category: 'Motion', scope: 'sprite', name: 'changeX', signature: 'sprite.changeX(amount)', description: 'Move right (or left with a negative number).', example: 'sprite.changeX(10)' },
  { category: 'Motion', scope: 'sprite', name: 'changeY', signature: 'sprite.changeY(amount)', description: 'Move up (or down with a negative number).', example: 'sprite.changeY(10)' },
  { category: 'Motion', scope: 'sprite', name: 'pointInDirection', signature: 'sprite.pointInDirection(degrees)', description: 'Face a direction: 90 is right, -90 is left, 0 is up, 180 is down.', example: 'sprite.pointInDirection(90)' },
  { category: 'Motion', scope: 'sprite', name: 'pointTowards', signature: 'sprite.pointTowards(target)', description: 'Turn to face another sprite or the mouse.', example: 'sprite.pointTowards("mouse")' },
  { category: 'Motion', scope: 'sprite', name: 'ifOnEdgeBounce', signature: 'sprite.ifOnEdgeBounce()', description: 'If the sprite is touching the edge of the stage, bounce back.', example: 'sprite.ifOnEdgeBounce()' },
  { category: 'Motion', scope: 'sprite', name: 'setRotationStyle', signature: 'sprite.setRotationStyle(style)', description: 'Choose how the sprite turns: "all around", "left-right", or "don\'t rotate".', example: 'sprite.setRotationStyle("left-right")' },
  { category: 'Motion', scope: 'sprite', name: 'x', signature: 'sprite.x', description: 'The sprite\'s left-right position. 0 is the middle.', example: 'console.log(sprite.x)' },
  { category: 'Motion', scope: 'sprite', name: 'y', signature: 'sprite.y', description: 'The sprite\'s up-down position. 0 is the middle.', example: 'console.log(sprite.y)' },
  { category: 'Motion', scope: 'sprite', name: 'direction', signature: 'sprite.direction', description: 'The direction the sprite is facing, in degrees.', example: 'console.log(sprite.direction)' },

  // Looks
  { category: 'Looks', scope: 'sprite', name: 'say', signature: 'sprite.say(text, seconds?)', description: 'Show a speech bubble. Add seconds (with await) to make it disappear after a while.', example: 'await sprite.say("Hello!", 2)' },
  { category: 'Looks', scope: 'sprite', name: 'think', signature: 'sprite.think(text, seconds?)', description: 'Show a thought bubble, like saying but with little circles.', example: 'sprite.think("Hmm...")' },
  { category: 'Looks', scope: 'sprite', name: 'switchCostume', signature: 'sprite.switchCostume(name)', description: 'Change how the sprite looks by picking one of its costumes by name.', example: 'sprite.switchCostume("cat-b")' },
  { category: 'Looks', scope: 'sprite', name: 'nextCostume', signature: 'sprite.nextCostume()', description: 'Switch to the next costume. Great for walking animations.', example: 'sprite.nextCostume()' },
  { category: 'Looks', scope: 'sprite', name: 'setSize', signature: 'sprite.setSize(percent)', description: 'Make the sprite bigger or smaller. 100 is normal size.', example: 'sprite.setSize(150)' },
  { category: 'Looks', scope: 'sprite', name: 'show', signature: 'sprite.show()', description: 'Make the sprite visible.', example: 'sprite.show()' },
  { category: 'Looks', scope: 'sprite', name: 'hide', signature: 'sprite.hide()', description: 'Make the sprite invisible. It can\'t be clicked or touched while hidden.', example: 'sprite.hide()' },
  { category: 'Looks', scope: 'sprite', name: 'setEffect', signature: 'sprite.setEffect(name, amount)', description: 'Add a visual effect: "ghost" (see-through), "brightness", or "color".', example: 'sprite.setEffect("ghost", 50)' },
  { category: 'Looks', scope: 'sprite', name: 'clearEffects', signature: 'sprite.clearEffects()', description: 'Remove all visual effects from the sprite.', example: 'sprite.clearEffects()' },
  { category: 'Looks', scope: 'sprite', name: 'goToFront', signature: 'sprite.goToFront()', description: 'Bring the sprite in front of all other sprites.', example: 'sprite.goToFront()' },
  { category: 'Looks', scope: 'sprite', name: 'goBack', signature: 'sprite.goBack(layers)', description: 'Send the sprite backwards behind other sprites.', example: 'sprite.goBack(1)' },

  // Pen
  { category: 'Pen', scope: 'sprite', name: 'penDown', signature: 'sprite.penDown()', description: 'Put the pen down, so the sprite draws a line everywhere it goes.', example: 'sprite.penDown()' },
  { category: 'Pen', scope: 'sprite', name: 'penUp', signature: 'sprite.penUp()', description: 'Lift the pen up, so the sprite can move without drawing.', example: 'sprite.penUp()' },
  { category: 'Pen', scope: 'sprite', name: 'stamp', signature: 'sprite.stamp()', description: 'Print a copy of how the sprite looks right now onto the stage.', example: 'sprite.stamp()' },
  { category: 'Pen', scope: 'sprite', name: 'setPenColor', signature: 'sprite.setPenColor(color)', description: 'Pick the pen\'s color by name, like "red" or "hotpink", or with a hex code like "#ff0000".', example: 'sprite.setPenColor("hotpink")' },
  { category: 'Pen', scope: 'sprite', name: 'setPenSize', signature: 'sprite.setPenSize(size)', description: 'Choose how thick the pen draws, from 1 (thin) up to 1200 (enormous).', example: 'sprite.setPenSize(5)' },
  { category: 'Pen', scope: 'sprite', name: 'changePenSize', signature: 'sprite.changePenSize(amount)', description: 'Make the pen thicker, or thinner with a negative number.', example: 'sprite.changePenSize(2)' },
  { category: 'Pen', scope: 'sprite', name: 'setPen', signature: 'sprite.setPen({ color, saturation, brightness, transparency })', description: 'Set any of the pen\'s color settings. Each one goes from 0 to 100.', example: 'sprite.setPen({ color: 50, saturation: 80 })' },
  { category: 'Pen', scope: 'sprite', name: 'changePen', signature: 'sprite.changePen({ color, saturation, brightness, transparency })', description: 'Add to the pen\'s color settings. Changing color a little each time makes a rainbow.', example: 'onUpdate(() => {\n  sprite.move(5)\n  sprite.turnRight(10)\n  sprite.changePen({ color: 2 })\n})' },
  { category: 'Pen', scope: 'global', name: 'eraseAll', signature: 'eraseAll()', description: 'Wipe everything the pens have drawn or stamped off the stage.', example: 'eraseAll()' },

  // Sound
  { category: 'Sound', scope: 'global', name: 'playSound', signature: 'playSound(name)', description: 'Start playing a sound. The code keeps going while it plays.', example: 'playSound("meow")' },
  { category: 'Sound', scope: 'global', name: 'playSoundUntilDone', signature: 'await playSoundUntilDone(name)', description: 'Play a sound and wait for it to finish before the next line runs.', example: 'await playSoundUntilDone("meow")' },
  { category: 'Sound', scope: 'global', name: 'setVolume', signature: 'setVolume(percent)', description: 'Set how loud sounds are, from 0 (silent) to 100 (full).', example: 'setVolume(50)' },

  // Events
  { category: 'Events', scope: 'global', name: 'onStart', signature: 'onStart(fn)', description: 'Run this code when the green Run flag is clicked. This is how every game begins.', example: 'onStart(() => {\n  sprite.say("Game on!")\n})' },
  { category: 'Events', scope: 'global', name: 'onKeyPress', signature: 'onKeyPress(key, fn)', description: 'Run this code when a key is pressed, like "right", "left", "up", "down", "space", or a letter.', example: 'onKeyPress("right", () => {\n  sprite.changeX(10)\n})' },
  { category: 'Events', scope: 'global', name: 'onClick', signature: 'onClick(fn)', description: 'Run this code when this sprite is clicked or tapped.', example: 'onClick(() => {\n  sprite.say("Ouch!")\n})' },
  { category: 'Events', scope: 'global', name: 'onMessage', signature: 'onMessage(name, fn)', description: 'Run this code when someone broadcasts this message. Great for making sprites talk to each other.', example: 'onMessage("game-over", () => {\n  sprite.hide()\n})' },
  { category: 'Events', scope: 'global', name: 'broadcast', signature: 'broadcast(name)', description: 'Send a message to every script that is listening with onMessage.', example: 'broadcast("game-over")' },
  { category: 'Events', scope: 'global', name: 'onUpdate', signature: 'onUpdate(fn)', description: 'Run this code every frame (about 60 times a second). Use it instead of a forever loop.', example: 'onUpdate(() => {\n  if (sprite.touching("Bat")) broadcast("caught")\n})' },
  { category: 'Events', scope: 'global', name: 'onBackdropSwitch', signature: 'onBackdropSwitch(name, fn)', description: 'Run this code when the stage switches to this backdrop.', example: 'onBackdropSwitch("night", () => {\n  sprite.hide()\n})' },

  // Sensing
  { category: 'Sensing', scope: 'sprite', name: 'touching', signature: 'sprite.touching(target)', description: 'True if this sprite is touching another sprite (by name) or "edge".', example: 'if (sprite.touching("Bat")) { sprite.say("Ouch!") }' },
  { category: 'Sensing', scope: 'sprite', name: 'distanceTo', signature: 'sprite.distanceTo(target)', description: 'How far away another sprite or the "mouse" is.', example: 'if (sprite.distanceTo("mouse") < 50) { sprite.say("Too close!") }' },
  { category: 'Sensing', scope: 'global', name: 'mouse', signature: 'mouse.x, mouse.y, mouse.isDown', description: 'Where the mouse pointer is on the stage, and whether the button is pressed.', example: 'sprite.goTo(mouse.x, mouse.y)' },
  { category: 'Sensing', scope: 'global', name: 'keyIsDown', signature: 'keyIsDown(key)', description: 'True while a key is held down. Check it inside onUpdate for smooth movement.', example: 'onUpdate(() => {\n  if (keyIsDown("right")) sprite.changeX(5)\n})' },
  { category: 'Sensing', scope: 'global', name: 'timer', signature: 'timer', description: 'How many seconds have passed since the game started (or since resetTimer).', example: 'console.log(timer)' },
  { category: 'Sensing', scope: 'global', name: 'resetTimer', signature: 'resetTimer()', description: 'Set the timer back to zero.', example: 'resetTimer()' },

  // Control
  { category: 'Control', scope: 'global', name: 'wait', signature: 'await wait(seconds)', description: 'Pause this script for some seconds. Needs await in front.', example: 'await wait(1)' },
  { category: 'Control', scope: 'sprite', name: 'clone', signature: 'sprite.clone()', description: 'Make a copy of this sprite. The copy starts at the same spot.', example: 'sprite.clone()' },
  { category: 'Control', scope: 'global', name: 'onCloneStart', signature: 'onCloneStart(fn)', description: 'Run this code for each new clone. The clone is handed to your function.', example: 'onCloneStart(clone => {\n  clone.goTo(0, 0)\n})' },
  { category: 'Control', scope: 'sprite', name: 'deleteClone', signature: 'sprite.deleteClone()', description: 'Remove this clone from the stage. Only works on clones.', example: 'onCloneStart(clone => {\n  clone.deleteClone()\n})' },
  { category: 'Control', scope: 'global', name: 'stopAll', signature: 'stopAll()', description: 'Stop the whole game, like the red stop sign in Scratch.', example: 'stopAll()' },

  // Stage
  { category: 'Stage', scope: 'global', name: 'stage.switchBackdrop', signature: 'stage.switchBackdrop(name)', description: 'Change the stage background by backdrop name.', example: 'stage.switchBackdrop("night")' },
  { category: 'Stage', scope: 'global', name: 'stage.nextBackdrop', signature: 'stage.nextBackdrop()', description: 'Switch to the next backdrop in the list.', example: 'stage.nextBackdrop()' },

  // Variables
  { category: 'Variables', scope: 'global', name: 'vars', signature: 'vars.name', description: 'Shared variables every script can see. Put your score here: vars.score = 0.', example: 'vars.score = 0' },
  { category: 'Variables', scope: 'global', name: 'watch', signature: 'watch(name)', description: 'Show a shared variable on the stage so players can see it, like a score.', example: 'vars.score = 0\nwatch("score")' },
]
