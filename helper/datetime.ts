export function getTimeUTC(d?: number): { h: number; m: number } {
  const date = d ? new Date(d) : new Date()
  const t = date.toISOString().split('T')[1].split(':')
  return { h: Number(t[0]), m: Number(t[1]) }
}
