import { isIdeMessage } from '../shared/protocol'

window.addEventListener('message', event => {
  if (!isIdeMessage(event.data)) return
  // Task 5 wires the session and renderer here.
})

parent.postMessage({ type: 'ready' }, '*')
