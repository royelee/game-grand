import type { Project } from '../shared/project'

/**
 * The tabs whose script mentions `name` as a quoted string literal.
 *
 * Renaming or deleting a backdrop or a sound silently breaks the code that
 * calls it — `playSound("meow")`, `stage.switchBackdrop("night")` — and nothing
 * here rewrites scripts, because a blind string replace would also hit
 * unrelated text like `say("meow")`. So this exists purely to warn first.
 *
 * A plain substring search for the two quoted forms, deliberately not a regex:
 * a Scratch name can contain quotes, brackets and other metacharacters
 * (`Water drop2`, `Boing!`), and matching literally means none of that needs
 * escaping. Quoting the needle is also what keeps `meow` from matching
 * `sayMeow` or `meowLoudly`.
 *
 * This is a heads-up, not a guarantee: a template literal or a computed name
 * won't match, so a kid can still break a script past this check.
 */
export function scriptsReferencing(project: Project, name: string): string[] {
  const needles = [`"${name}"`, `'${name}'`]
  const mentions = (script: string) => needles.some(needle => script.includes(needle))

  const tabs: string[] = []
  if (mentions(project.mainScript)) tabs.push('main')
  for (const sprite of project.sprites) {
    if (mentions(sprite.script)) tabs.push(sprite.name)
  }
  return tabs
}

/** "main and Cat", "main, Cat and Bat" — for a sentence a kid reads once. */
export function joinTabNames(tabs: string[]): string {
  if (tabs.length <= 1) return tabs.join('')
  return `${tabs.slice(0, -1).join(', ')} and ${tabs[tabs.length - 1]}`
}
