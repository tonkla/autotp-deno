import { Candlestick, CandlestickChange, Ticker } from '../../types/index.ts'
import { toNumber } from '../../helper/number.ts'
import { OrderStatus } from '../../consts/index.ts'
import { Order, SymbolInfo } from '../../types/index.ts'
import { buildGetQs, buildPostQs, sign } from './common.ts'
import {
  Response24hrTicker,
  ResponseNewOrder,
  ResponseOrderStatus,
  ResponseTradesList,
  ResponseSuccess,
  ResponseError,
} from './types.ts'

const baseUrl = 'https://fapi.binance.com/fapi'

export class PrivateApi {
  private apiKey: string
  private secretKey: string

  constructor(apiKey: string, secretKey: string) {
    this.apiKey = apiKey
    this.secretKey = secretKey
  }

  async placeOrder(order: Order): Promise<Order | null> {
    try {
      const qs = buildPostQs(order)
      const signature = sign(qs, this.secretKey)
      const headers = { 'X-MBX-APIKEY': this.apiKey }
      const url = `${baseUrl}/v1/order?${qs}&signature=${signature}`
      const res = await fetch(url, { method: 'POST', headers })
      const data: ResponseNewOrder & ResponseError = await res.json()
      if (data.code < 0) {
        console.error({ error: data.msg, order })
        return null
      }
      const allowed = [OrderStatus.New, OrderStatus.Filled, OrderStatus.PartiallyFilled] as string[]
      if (!allowed.includes(data.status)) {
        return null
      }
      return {
        ...order,
        status: data.status || OrderStatus.New,
        refId: data.orderId.toString(),
        openTime: new Date(data.updateTime),
      }
    } catch (e) {
      console.error(e)
      return null
    }
  }

  async cancelOrder(symbol: string, id: string, refId: string): Promise<ResponseSuccess | null> {
    try {
      const qs = buildGetQs({ symbol, id, refId })
      const signature = sign(qs, this.secretKey)
      const headers = { 'X-MBX-APIKEY': this.apiKey }
      const url = `${baseUrl}/v1/order?${qs}&signature=${signature}`
      const res = await fetch(url, { method: 'DELETE', headers })
      const data: ResponseNewOrder & ResponseError = await res.json()
      if (data.code < 0) {
        console.error({ error: data.msg, symbol, id })
        return null
      }
      return {
        status: data.status,
        updateTime: new Date(),
      }
    } catch (e) {
      console.error(e)
      return null
    }
  }

  async getOrder(symbol: string, id: string, refId: string): Promise<Order | null> {
    try {
      const qs = buildGetQs({ symbol, id })
      const signature = sign(qs, this.secretKey)
      const headers = { 'X-MBX-APIKEY': this.apiKey }
      const url = `${baseUrl}/v1/order?${qs}&signature=${signature}`
      const res = await fetch(url, { method: 'GET', headers })
      const data: ResponseOrderStatus & ResponseError = await res.json()
      if (data.code < 0) {
        console.error({ error: data.msg, symbol, id })
        return null
      }
      const order: Order = {
        symbol,
        id,
        refId,
        side: data.side,
        positionSide: data.positionSide,
        type: data.origType,
        status: data.status,
        stopPrice: toNumber(data.stopPrice),
        openPrice: toNumber(data.price),
        closePrice: 0,
        qty: toNumber(data.origQty),
        commission: 0,
        pl: 0,
        openTime: new Date(data.time),
        updateTime: new Date(data.updateTime),
      }
      return order
    } catch (e) {
      console.error(e)
      return null
    }
  }

  async getTradesList(symbol: string, limit: number): Promise<Order[]> {
    try {
      const qs = buildGetQs({ symbol, limit })
      const signature = sign(qs, this.secretKey)
      const headers = { 'X-MBX-APIKEY': this.apiKey }
      const url = `${baseUrl}/v1/userTrades?${qs}&signature=${signature}`
      const res = await fetch(url, { method: 'GET', headers })
      const data: ResponseTradesList[] & ResponseError = await res.json()
      if (data.code < 0) {
        console.error({ error: data.msg, symbol })
        return []
      }
      return data.map((d) => ({
        symbol,
        id: '',
        refId: d.orderId.toString(),
        side: d.side,
        positionSide: d.positionSide,
        status: '',
        type: '',
        openPrice: 0,
        closePrice: toNumber(d.price),
        qty: toNumber(d.qty),
        commission: toNumber(d.commission),
        pl: toNumber(d.realizedPnl),
        updateTime: new Date(d.time),
      }))
    } catch (e) {
      console.error(e)
      return []
    }
  }
}

export async function getExchangeInfo(): Promise<SymbolInfo[]> {
  try {
    const res = await fetch(`${baseUrl}/v1/exchangeInfo`)
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

export async function getCandlesticks(
  symbol: string,
  interval: string,
  limit: number
): Promise<Candlestick[]> {
  try {
    const url = `${baseUrl}/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`
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
    const url = `${baseUrl}/v1/ticker/price?symbol=${symbol}`
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
    const url = `${baseUrl}/v1/ticker/24hr`
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
    const url = `${baseUrl}/v1/ticker/24hr`
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
