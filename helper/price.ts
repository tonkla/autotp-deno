import { OrderSide } from '../consts/index.ts'
import { Candlestick, OHLC, TfPrice } from '../types/index.ts'
import { round } from './number.ts'

export function getHighs(candlesticks: Candlestick[]): number[][] {
  const h = []
  for (const p of candlesticks) {
    h.push(p.high)
  }
  return [h]
}

export function getLows(candlesticks: Candlestick[]): number[][] {
  const l = []
  for (const p of candlesticks) {
    l.push(p.low)
  }
  return [l]
}

export function getCloses(candlesticks: Candlestick[]): number[][] {
  const c = []
  for (const p of candlesticks) {
    c.push(p.close)
  }
  return [c]
}

export function getHLs(candlesticks: Candlestick[]): number[][] {
  const h = []
  const l = []
  for (const p of candlesticks) {
    h.push(p.high)
    l.push(p.low)
  }
  return [h, l]
}

export function getHLCs(candlesticks: Candlestick[]): number[][] {
  const h = []
  const l = []
  const c = []
  for (const p of candlesticks) {
    h.push(p.high)
    l.push(p.low)
    c.push(p.close)
  }
  return [h, l, c]
}

export function getOHLCs(candlesticks: Candlestick[]): number[][] {
  const o = []
  const h = []
  const l = []
  const c = []
  for (const p of candlesticks) {
    o.push(p.open)
    h.push(p.high)
    l.push(p.low)
    c.push(p.close)
  }
  return [o, h, l, c]
}

export function getHighsLowsClosesOHLC(candlesticks: OHLC[]): number[][] {
  const h = []
  const l = []
  const c = []
  for (const p of candlesticks) {
    h.push(p.h)
    l.push(p.l)
    c.push(p.c)
  }
  return [h, l, c]
}

export function getHighestHigh(candlesticks: Candlestick[]): Candlestick {
  return candlesticks.slice().sort((a, b) => b.high - a.high)[0]
}

export function getLowestLow(candlesticks: Candlestick[]): Candlestick {
  return candlesticks.slice().sort((a, b) => a.low - b.low)[0]
}

export function getHighestHighOHLC(candlesticks: OHLC[]): OHLC {
  return candlesticks.slice().sort((a, b) => b.h - a.h)[0]
}

export function getLowestLowOHLC(candlesticks: OHLC[]): OHLC {
  return candlesticks.slice().sort((a, b) => a.l - b.l)[0]
}

export function getOHLC(candlesticks: OHLC[] | null): OHLC {
  if (!Array.isArray(candlesticks) || candlesticks.length === 0) return { o: 0, h: 0, l: 0, c: 0 }
  const o = candlesticks.slice(0, 1)[0].o
  const c = candlesticks.slice(-1)[0].c
  const h = getHighestHighOHLC(candlesticks).h
  const l = getLowestLowOHLC(candlesticks).l
  return { o, h, l, c }
}

export function calcSlopes(input: number[], atr: number, size = 1): number[] {
  const _input = input.slice(-(size + 1))
  const output = []
  for (let i = 1; i < _input.length; i++) {
    output.push(round((_input[i] - _input[i - 1]) / atr, 3))
  }
  return output
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

export function calcTfPriceOHLC(candles: OHLC[], price: number): TfPrice {
  const hh = getHighestHighOHLC(candles).h
  const ll = getLowestLowOHLC(candles).l
  const ratio = round(100 - ((hh - price) / (hh - ll)) * 100, 2)
  return {
    high: hh,
    low: ll,
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
