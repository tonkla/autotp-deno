import { OrderSide } from '../consts/index.ts'
import { Candlestick, TfPrice } from '../types/index.ts'
import { round } from './number.ts'

export function getHighs(candlesticks: Candlestick[]): number[][] {
  const h: number[] = []
  for (const p of candlesticks) {
    h.push(p.high)
  }
  return [h]
}

export function getLows(candlesticks: Candlestick[]): number[][] {
  const l: number[] = []
  for (const p of candlesticks) {
    l.push(p.low)
  }
  return [l]
}

export function getCloses(candlesticks: Candlestick[]): number[][] {
  const c: number[] = []
  for (const p of candlesticks) {
    c.push(p.close)
  }
  return [c]
}

export function getHighsLows(candlesticks: Candlestick[]): number[][] {
  const h: number[] = []
  const l: number[] = []
  for (const p of candlesticks) {
    h.push(p.high)
    l.push(p.low)
  }
  return [h, l]
}

export function getHighsLowsCloses(candlesticks: Candlestick[]): number[][] {
  const h: number[] = []
  const l: number[] = []
  const c: number[] = []
  for (const p of candlesticks) {
    h.push(p.high)
    l.push(p.low)
    c.push(p.close)
  }
  return [h, l, c]
}

export function getHighestHigh(candlesticks: Candlestick[]): Candlestick {
  return candlesticks.slice().sort((a, b) => b.high - a.high)[0]
}

export function getLowestLow(candlesticks: Candlestick[]): Candlestick {
  return candlesticks.slice().sort((a, b) => a.low - b.low)[0]
}

export function calcTfPrice(candles: Candlestick[], price: number): TfPrice {
  const highest = getHighestHigh(candles)
  const lowest = getLowestLow(candles)
  // const open = candles[0].open
  const hl = highest.high - lowest.low
  const ratio = round(100 - ((highest.high - price) / hl) * 100, 2)
  return {
    // open,
    high: highest.high,
    low: lowest.low,
    // pcAtr: round(((price - open) / atr) * 100, 2),
    pcHL: ratio < 0 ? 0 : ratio > 100 ? 100 : ratio,
  }
}

export function calcSLStop(side: string, sl: number, gap: number, precision: number): number {
  const pow = Math.pow(10, precision)
  return side === OrderSide.Buy
    ? round((sl * pow + gap) / pow, precision)
    : round((sl * pow - gap) / pow, precision)
}

export function calcTPStop(side: string, tp: number, gap: number, precision: number): number {
  const pow = Math.pow(10, precision)
  return side === OrderSide.Buy
    ? round((tp * pow - gap) / pow, precision)
    : round((tp * pow + gap) / pow, precision)
}

export function calcStopUpper(price: number, gap: number, precision: number): number {
  return calcSLStop(OrderSide.Buy, price, gap, precision)
}

export function calcStopLower(price: number, gap: number, precision: number): number {
  return calcTPStop(OrderSide.Buy, price, gap, precision)
}
