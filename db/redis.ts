import { difference } from 'https://deno.land/std@0.126.0/datetime/mod.ts'
import { Redis } from 'https://deno.land/x/redis@v0.25.2/mod.ts'

import { RedisKeys } from '../consts/index.ts'
import { BookTicker, SymbolInfo, Ticker } from '../types/index.ts'

function countPrecision(n: number): number {
  const p = n.toString().split('.')[1]
  return p === undefined ? 0 : p.length
}

export async function getMarkPrice(
  redis: Redis,
  exchange: string,
  symbol: string,
  maxOutdatedSec?: number
): Promise<number> {
  try {
    const _ticker = await redis.get(RedisKeys.MarkPrice(exchange, symbol))
    if (!_ticker) return 0
    const ticker: Ticker = JSON.parse(_ticker)
    if (maxOutdatedSec) {
      const diff = difference(new Date(ticker.time), new Date(), { units: ['seconds'] })
      if (diff?.seconds === undefined || diff.seconds > maxOutdatedSec) {
        return 0
      }
    }
    return ticker.price
  } catch {
    return 0
  }
}

// Note: WTF? because the API '/fapi/v1/exchangeInfo' returns incorrect precision.
export async function getSymbolInfo(
  redis: Redis,
  exchange: string,
  symbol: string
): Promise<SymbolInfo | null> {
  try {
    const _bookTicker = await redis.get(RedisKeys.BookTicker(exchange, symbol))
    if (!_bookTicker) return null

    const bt: BookTicker = JSON.parse(_bookTicker)
    const p1 = countPrecision(bt.bestBidPrice)
    const p2 = countPrecision(bt.bestAskPrice)
    const pricePrecision = p1 > p2 ? p1 : p2

    const q1 = countPrecision(bt.bestBidQty)
    const q2 = countPrecision(bt.bestAskQty)
    const qtyPrecision = q1 > q2 ? q1 : q2

    return { symbol, pricePrecision, qtyPrecision }
  } catch {
    return null
  }
}
