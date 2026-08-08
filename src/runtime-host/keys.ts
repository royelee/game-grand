const NAMED: Record<string, string> = {
  ArrowRight: 'right',
  ArrowLeft: 'left',
  ArrowUp: 'up',
  ArrowDown: 'down',
  ' ': 'space',
  Enter: 'enter',
  Escape: 'escape',
}

/** Browser KeyboardEvent.key → the names kids write in onKeyPress/keyIsDown. */
export function keyName(key: string): string {
  return NAMED[key] ?? key.toLowerCase()
}
