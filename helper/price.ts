import { Candlestick } from '../types/index.ts'

export function getHighs(prices: Candlestick[]): number[][] {
  const h: number[] = []
  for (const p of prices) {
    h.push(p.high)
  }
  return [h]
}

export function getLows(prices: Candlestick[]): number[][] {
  const l: number[] = []
  for (const p of prices) {
    l.push(p.low)
  }
  return [l]
}

export function getCloses(prices: Candlestick[]): number[][] {
  const c: number[] = []
  for (const p of prices) {
    c.push(p.close)
  }
  return [c]
}

export function getHighsLows(prices: Candlestick[]): number[][] {
  const h: number[] = []
  const l: number[] = []
  for (const p of prices) {
    h.push(p.high)
    l.push(p.low)
  }
  return [h, l]
}

export function getHighsLowsCloses(prices: Candlestick[]): number[][] {
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
