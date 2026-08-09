export class FriendlyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FriendlyError'
  }
}

export function show(value: unknown): string {
  if (typeof value === 'string') return `"${value}"`
  if (value === undefined) return 'nothing'
  if (typeof value === 'function') return 'a function'
  return String(value)
}

export function expectNumber(fn: string, example: string, value: unknown): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new FriendlyError(
      `\`${fn}\` needs a number, like \`${example}\` — you gave it ${show(value)}.`,
    )
  }
  return value
}

export function expectString(fn: string, example: string, value: unknown): string {
  if (typeof value !== 'string') {
    throw new FriendlyError(
      `\`${fn}\` needs some text in quotes, like \`${example}\` — you gave it ${show(value)}.`,
    )
  }
  return value
}

export function expectFunction(fn: string, example: string, value: unknown): Function {
  if (typeof value !== 'function') {
    throw new FriendlyError(
      `\`${fn}\` needs a function, like \`${example}\` — you gave it ${show(value)}.`,
    )
  }
  return value
}
