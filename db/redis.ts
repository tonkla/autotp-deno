import { Redis } from 'https://deno.land/x/redis@v0.25.2/mod.ts'

import { RedisKeys } from '../consts/index.ts'
import { BookTicker, SymbolInfo } from '../types/index.ts'

function countPrecision(n: number): number {
  const p = n.toString().split('.')[1]
  return p === undefined ? 0 : p.length
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
