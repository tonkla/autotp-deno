import { sign } from '../../helper/crypto.ts'
import { toNumber } from '../../helper/number.ts'
import { AccountInfo, BookTicker, Candlestick, PositionRisk } from '../../types/index.ts'
import { buildGetQs } from './common.ts'
import {
  Response24hrTicker,
  ResponseAccountInfo,
  ResponseBookTicker,
  ResponseError,
  ResponsePositionRisk,
} from './types.ts'

const baseUrl = 'https://api.binance.com/api'

function BinanceSpot(apiKey: string, secretKey: string) {
  async function getAccountInfo(): Promise<AccountInfo | null> {
    try {
      const qs = buildGetQs({ symbol: '' })
      const signature = sign(qs, secretKey)
      const headers = { 'X-MBX-APIKEY': apiKey }
      const url = `${baseUrl}/v2/account?${qs}&signature=${signature}`
      const res = await fetch(url, { method: 'GET', headers })
      const data: ResponseAccountInfo & ResponseError = await res.json()
      if (data.code < 0) {
        console.error({ code: data.code, error: data.msg })
        return null
      }
      return {
        totalWalletBalance: toNumber(data.totalWalletBalance),
        totalMarginBalance: toNumber(data.totalMarginBalance),
        totalUnrealizedProfit: toNumber(data.totalUnrealizedProfit),
      }
    } catch (e) {
      console.error(e)
      return null
    }
  }

  async function getOpenPositions(symbol?: string): Promise<PositionRisk[]> {
    try {
      const qs = buildGetQs({ symbol: symbol ?? '' })
      const signature = sign(qs, secretKey)
      const headers = { 'X-MBX-APIKEY': apiKey }
      const url = `${baseUrl}/v2/positionRisk?${qs}&signature=${signature}`
      const res = await fetch(url, { method: 'GET', headers })
      const data: ResponsePositionRisk[] & ResponseError = await res.json()
      if (data.code < 0) {
        console.error(JSON.stringify({ code: data.code, error: data.msg }))
        return []
      }
      return data.map((d) => ({
        symbol: d.symbol,
        positionAmt: toNumber(d.positionAmt),
        entryPrice: toNumber(d.entryPrice),
        markPrice: toNumber(d.markPrice),
        unrealizedProfit: toNumber(d.unRealizedProfit ?? 0),
        positionSide: d.positionSide,
        updateTime: d.updateTime,
      }))
    } catch (e) {
      console.error(e)
      return []
    }
  }

  async function getBookTicker(symbol: string): Promise<BookTicker | null> {
    try {
      const url = `${baseUrl}/v3/ticker/bookTicker?symbol=${symbol}`
      const res = await fetch(url)
      const item: ResponseBookTicker = await res.json()
      if (!item) return null
      return {
        symbol: item.symbol,
        time: 0,
        bestBidPrice: toNumber(item.bidPrice),
        bestBidQty: toNumber(item.bidQty),
        bestAskPrice: toNumber(item.askPrice),
        bestAskQty: toNumber(item.askQty),
        spread: toNumber(item.askPrice) - toNumber(item.bidPrice),
      }
    } catch {
      return null
    }
  }

  async function getCandlesticks(
    symbol: string,
    interval: string,
    limit: number
  ): Promise<Candlestick[]> {
    try {
      const url = `${baseUrl}/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`
      const res = await fetch(url)
      const data = await res.json()
      if (!Array.isArray(data)) return []
      return data.map((d: string[]) => ({
        symbol,
        openTime: toNumber(d[0]),
        open: toNumber(d[1]),
        high: toNumber(d[2]),
        low: toNumber(d[3]),
        close: toNumber(d[4]),
        closeTime: toNumber(d[6]),
        volume: toNumber(d[7]),
        change: 0,
        time: Date.now(),
      }))
    } catch {
      return []
    }
  }

  async function getTicker24hr(): Promise<Candlestick[]> {
    try {
      const url = `${baseUrl}/v3/ticker/24hr`
      const res = await fetch(url)
      const items: Response24hrTicker[] = await res.json()
      if (!Array.isArray(items)) return []
      return items.map((i) => ({
        symbol: i.symbol,
        openTime: i.openTime,
        closeTime: i.closeTime,
        open: toNumber(i.openPrice),
        high: toNumber(i.highPrice),
        low: toNumber(i.lowPrice),
        close: toNumber(i.lastPrice),
        volume: toNumber(i.quoteVolume),
        change: toNumber(i.priceChangePercent),
        time: Date.now(),
      }))
    } catch {
      return []
    }
  }

  async function getTopGainers(n: number, tickers?: Candlestick[]): Promise<Candlestick[]> {
    try {
      const items = Array.isArray(tickers) ? tickers : await getTicker24hr()
      return items
        .filter((i) => i.symbol.endsWith('BUSD') && i.symbol.indexOf('_') < 0 && i.change > 0)
        .sort((a, b) => (b.change > a.change ? 1 : -1))
        .slice(0, n)
    } catch {
      return []
    }
  }

  async function getTopVolumes(n: number, tickers?: Candlestick[]): Promise<Candlestick[]> {
    try {
      const items = Array.isArray(tickers) ? tickers : await getTicker24hr()
      return items
        .filter((i) => i.symbol.endsWith('BUSD') && i.symbol.indexOf('_') < 0)
        .sort((a, b) => (b.volume > a.volume ? 1 : -1))
        .slice(0, n)
    } catch {
      return []
    }
  }

  async function getTopTrades(n: number) {
    const tickers = await getTicker24hr()
    const topGainers = await getTopGainers(n, tickers)
    const topVolumes = await getTopVolumes(n, tickers)
    return {
      topGainers,
      topVolumes,
    }
  }

  return {
    getAccountInfo,
    getOpenPositions,

    getBookTicker,
    getCandlesticks,
    getTopTrades,
  }
}

export default { new: BinanceSpot }
