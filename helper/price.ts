import { OrderSide } from '../consts/index.ts'
import { Candlestick } from '../types/index.ts'
import { round } from './number.ts'

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

export function calcSLStop(side: string, sl: number, gap: number, precision: number): number {
  const pow = Math.pow(10, precision)
  if (side === OrderSide.Buy) {
    return round((sl * pow + gap) / pow, precision)
  }
  return round((sl * pow - gap) / pow, precision)
}

export function calcTPStop(side: string, tp: number, gap: number, precision: number): number {
  const pow = Math.pow(10, precision)
  if (side === OrderSide.Buy) {
    return round((tp * pow - gap) / pow, precision)
  }
  return round((tp * pow + gap) / pow, precision)
}

export function calcStopUpper(price: number, gap: number, precision: number): number {
  return calcSLStop(OrderSide.Buy, price, gap, precision)
}

export function calcStopLower(price: number, gap: number, precision: number): number {
  return calcTPStop(OrderSide.Buy, price, gap, precision)
}
