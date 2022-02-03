import { Candlestick, CandlestickChange, Ticker } from '../../types/index.ts'
import { toNumber } from '../../helper/number.ts'
import { OrderType } from '../../consts/index.ts'
import { Order, SymbolInfo } from '../../types/index.ts'
import { buildQs, sign } from './common.ts'
import { Response24hrTicker, ResponseNewOrder } from './types.ts'

const baseUrl = 'https://fapi.binance.com'

export class PrivateApi {
  private apiKey: string
  private secretKey: string

  constructor(apiKey: string, secretKey: string) {
    this.apiKey = apiKey
    this.secretKey = secretKey
  }

  async openLimitOrder(order: Order): Promise<Order | null> {
    if (order.type !== OrderType.Limit) return Promise.resolve(null)

    try {
      const qs = buildQs(order)
      const signature = sign(qs, this.secretKey)
      // console.log(`${baseUrl}${qs}&signature=${signature}`)
      const res = await fetch(`${baseUrl}${qs}&signature=${signature}`, { method: 'POST' })
      const data: ResponseNewOrder = await res.json()
      console.log('data', data)
      return Promise.resolve(null)
    } catch {
      return Promise.resolve(null)
    }
  }
}

export async function getExchangeInfo(): Promise<SymbolInfo[]> {
  try {
    const res = await fetch(`${baseUrl}/fapi/v1/exchangeInfo`)
    const { symbols } = await res.json()
    if (Array.isArray(symbols)) {
      return Promise.resolve(
        symbols.map((s) => ({
          symbol: s.symbol,
          pricePrecision: s.pricePrecision,
          qtyPrecision: s.quantityPrecision,
        }))
      )
    }
    return Promise.resolve([])
  } catch {
    return Promise.resolve([])
  }
}

export function getSymbolInfo(symbols: SymbolInfo[], symbol: string): SymbolInfo | null {
  if (Array.isArray(symbols)) {
    return symbols.find((i) => i.symbol === symbol) ?? null
  }
  return null
}

export async function getCandlesticks(
  symbol: string,
  interval: string,
  limit: number
): Promise<Candlestick[]> {
  try {
    const url = `${baseUrl}/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`
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

export async function getTicker(symbol: string): Promise<Ticker | null> {
  try {
    const url = `${baseUrl}/fapi/v1/ticker/price?symbol=${symbol}`
    const res = await fetch(url)
    const { price, time }: Ticker = await res.json()
    return {
      symbol,
      price: Number(price),
      time,
    }
  } catch {
    return null
  }
}

export async function getTicker24hr(): Promise<Candlestick[]> {
  try {
    const url = `${baseUrl}/fapi/v1/ticker/24hr`
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

export async function getTicker24hrChanges(): Promise<CandlestickChange[]> {
  try {
    const url = `${baseUrl}/fapi/v1/ticker/24hr`
    const res = await fetch(url)
    const items: Response24hrTicker[] = await res.json()
    if (!Array.isArray(items)) return []
    return items.map((i) => ({
      symbol: i.symbol,
      volume: toNumber(i.quoteVolume),
      change: toNumber(i.priceChangePercent),
      time: Date.now(),
    }))
  } catch {
    return []
  }
}

export async function getTopGainers(n: number): Promise<Candlestick[]> {
  try {
    const items = await getTicker24hr()
    return items
      .filter((i) => i.symbol.indexOf('USDT') > 0 && i.change > 0)
      .sort((a, b) => (a.change < b.change ? 1 : -1))
      .slice(0, n)
  } catch {
    return []
  }
}

export async function getTopLosers(n: number): Promise<Candlestick[]> {
  try {
    const items = await getTicker24hr()
    return items
      .filter((i) => i.symbol.indexOf('USDT') > 0 && i.change < 0)
      .sort((a, b) => (a.change > b.change ? 1 : -1))
      .slice(0, n)
  } catch {
    return []
  }
}

export async function getTopVolumes(n: number): Promise<Candlestick[]> {
  try {
    const items = await getTicker24hr()
    return items
      .filter((i) => i.symbol.indexOf('USDT') > 0)
      .sort((a, b) => (a.volume < b.volume ? 1 : -1))
      .slice(0, n)
  } catch {
    return []
  }
}

export async function getTopVolumeGainers(top: number, n: number): Promise<Candlestick[]> {
  try {
    const items = await getTopVolumes(top)
    return items
      .filter((i) => i.change > 0)
      .sort((a, b) => (a.change < b.change ? 1 : -1))
      .slice(0, n)
  } catch {
    return []
  }
}

export async function getTopVolumeLosers(top: number, n: number): Promise<Candlestick[]> {
  try {
    const items = await getTopVolumes(top)
    return items
      .filter((i) => i.change < 0)
      .sort((a, b) => (a.change > b.change ? 1 : -1))
      .slice(0, n)
  } catch {
    return []
  }
}
