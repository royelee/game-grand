import Phaser from 'phaser'
import { STAGE_WIDTH, STAGE_HEIGHT } from '../runtime/spriteModel'
import { isIdeMessage, type RunPayload } from '../shared/protocol'
import { RuntimeSession } from './session'
import { StageScene } from './scene'

let game: Phaser.Game | null = null
let scene: StageScene | null = null

function post(message: unknown): void {
  parent.postMessage(message, '*')
}

function startRun(payload: RunPayload): void {
  scene?.stopSounds()
  game?.destroy(true)
  const session = new RuntimeSession(payload, {
    onIssue: issue => post({ type: 'issue', issue }),
    onLog: text => post({ type: 'log', text }),
    onStopped: () => {
      scene?.stopSounds()
      post({ type: 'stopped' })
    },
  })
  const s = new StageScene(session, payload)
  scene = s
  game = new Phaser.Game({
    type: Phaser.AUTO,
    width: STAGE_WIDTH,
    height: STAGE_HEIGHT,
    parent: 'stage',
    backgroundColor: '#ffffff',
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: s,
  })
}

window.addEventListener('message', event => {
  if (isIdeMessage(event.data)) startRun(event.data.payload)
})

post({ type: 'ready' })
