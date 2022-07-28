import { datetime } from '../deps.ts'

export function getTimeUTC(d?: number): { h: number; m: number } {
  const date = d ? new Date(d) : new Date()
  const t = date.toISOString().split('T')[1].split(':')
  return { h: Number(t[0]), m: Number(t[1]) }
}

export function secondsToNow(date = new Date()): number {
  const diff = datetime.difference(date, new Date(), { units: ['seconds'] })
  return diff?.seconds ?? 0
}

export function minutesToNow(date = new Date()): number {
  const diff = datetime.difference(date, new Date(), { units: ['minutes'] })
  return diff?.minutes ?? 0
}
