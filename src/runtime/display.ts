// Formats an arbitrary runtime value for user-facing output (console.log,
// watch stringification): plain objects and arrays render as JSON so users
// can actually see their shape; everything else uses String().
export function display(value: unknown): string {
  if (typeof value === 'object' && value !== null) return JSON.stringify(value)
  return String(value)
}
