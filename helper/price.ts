import { HistoricalPrice } from '../types/index.ts'

export function getHighs(prices: HistoricalPrice[]): number[][] {
  const h: number[] = []
  for (const p of prices) {
    h.push(p.high)
  }
  return [h]
}

export function getLows(prices: HistoricalPrice[]): number[][] {
  const l: number[] = []
  for (const p of prices) {
    l.push(p.low)
  }
  return [l]
}

export function getCloses(prices: HistoricalPrice[]): number[][] {
  const c: number[] = []
  for (const p of prices) {
    c.push(p.close)
  }
  return [c]
}

export function getHighsLows(prices: HistoricalPrice[]): number[][] {
  const h: number[] = []
  const l: number[] = []
  for (const p of prices) {
    h.push(p.high)
    l.push(p.low)
  }
  return [h, l]
}

export function getHighsLowsCloses(prices: HistoricalPrice[]): number[][] {
  const h: number[] = []
  const l: number[] = []
  const c: number[] = []
  for (const p of prices) {
    h.push(p.high)
    l.push(p.low)
    c.push(p.close)
  }
  return [h, l, c]
}
