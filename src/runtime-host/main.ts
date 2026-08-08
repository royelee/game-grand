import Phaser from 'phaser'
import { STAGE_WIDTH, STAGE_HEIGHT } from '../runtime/spriteModel'
import { isIdeMessage, type RunPayload } from '../shared/protocol'
import { RuntimeSession } from './session'
import { StageScene } from './scene'

let game: Phaser.Game | null = null

function post(message: unknown): void {
  parent.postMessage(message, '*')
}

function startRun(payload: RunPayload): void {
  game?.destroy(true)
  const session = new RuntimeSession(payload, {
    onIssue: issue => post({ type: 'issue', issue }),
    onLog: text => post({ type: 'log', text }),
    onStopped: () => post({ type: 'stopped' }),
  })
  game = new Phaser.Game({
    type: Phaser.AUTO,
    width: STAGE_WIDTH,
    height: STAGE_HEIGHT,
    parent: 'stage',
    backgroundColor: '#ffffff',
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: new StageScene(session, payload),
  })
}

window.addEventListener('message', event => {
  if (isIdeMessage(event.data)) startRun(event.data.payload)
})

post({ type: 'ready' })
