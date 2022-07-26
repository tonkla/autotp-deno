import { datetime, redis as rd } from '../deps.ts'

import { BookTicker, SymbolInfo, Ticker } from '../types/index.ts'

export type Redis = rd.Redis

export const RedisKeys = {
  BookTicker: (exchange: string, symbol: string) => `book-${exchange}-${symbol}`,
  CandlestickAll: (exchange: string, symbol: string, interval: string) =>
    `candle-all-${exchange}-${symbol}-${interval}`,
  CandlestickLast: (exchange: string, symbol: string, interval: string) =>
    `candle-last-${exchange}-${symbol}-${interval}`,
  OHLCAll: (exchange: string, symbol: string, interval: string) =>
    `ohlc-all-${exchange}-${symbol}-${interval}`,
  OHLCLast: (exchange: string, symbol: string, interval: string) =>
    `ohlc-last-${exchange}-${symbol}-${interval}`,
  Failed: (exchange: string, botId: string, symbol: string, type: string) =>
    `failed-${exchange}-${botId}-${symbol}-${type}`,
  MarkPrice: (exchange: string, symbol: string) => `price-${exchange}-${symbol}`,
  Order: (exchange: string) => `order-${exchange}`,
  PnL: (exchange: string, botId: string, posSide: string) => `pnl-${exchange}-${botId}-${posSide}`,
  Position: (exchange: string, symbol: string, posSide: string) =>
    `position-${exchange}-${symbol}-${posSide}`,
  Positions: (exchange: string) => `positions-${exchange}`,
  PriceChange: (exchange: string, symbol: string) => `change-${exchange}-${symbol}`,
  SymbolInfo: (exchange: string, symbol: string) => `symbol-${exchange}-${symbol}`,
  SymbolsFutures: (exchange: string) => `symbols-futures-${exchange}`,
  TA: (exchange: string, symbol: string, interval?: string) =>
    `ta-${exchange}-${symbol}${interval ? `-${interval}` : ''}`,
  TAOHLC: (exchange: string, symbol: string, interval: string) =>
    `ta-ohlc-${exchange}-${symbol}-${interval}`,
  TopGainers: (exchange: string) => `gainers-${exchange}`,
  TopLosers: (exchange: string) => `losers-${exchange}`,
  TopVols: (exchange: string) => `vols-${exchange}`,
  TopLongs: (exchange: string) => `longs-${exchange}`,
  TopShorts: (exchange: string) => `shorts-${exchange}`,
}

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
      const diff = datetime.difference(new Date(ticker.time), new Date(), { units: ['seconds'] })
      if (diff?.seconds === undefined || diff.seconds > maxOutdatedSec) {
        return 0
      }
    }
    return ticker.price
  } catch {
    return 0
  }
}

// Note: WTF? because the API '/fapi/v1/exchangeInfo' returns incorrect precisions.
export async function getSymbolInfo(
  redis: Redis,
  exchange: string,
  symbol: string
): Promise<SymbolInfo | null> {
  try {
    const bookTicker = await redis.get(RedisKeys.BookTicker(exchange, symbol))
    if (!bookTicker) return null

    const bt: BookTicker = JSON.parse(bookTicker)
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
