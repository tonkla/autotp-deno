import { Candlestick, Ticker } from '../../types/index.ts'
import { toNumber } from '../../helper/number.ts'
import { OrderStatus, OrderType } from '../../consts/index.ts'
import { Order, SymbolInfo } from '../../types/index.ts'
import { buildGetQs, buildPostQs, sign } from './common.ts'
import { Errors } from './enums.ts'
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

  async placeLimitOrder(order: Order): Promise<Order | number | null> {
    try {
      const qs = buildPostQs(order) + '&timeInForce=GTC'
      const signature = sign(qs, this.secretKey)
      const headers = { 'X-MBX-APIKEY': this.apiKey }
      const url = `${baseUrl}/v1/order?${qs}&signature=${signature}`
      const res = await fetch(url, { method: 'POST', headers })
      const data: ResponseNewOrder & ResponseError = await res.json()
      if (data.code < 0) {
        if (data.code !== Errors.OrderWouldImmediatelyTrigger) {
          console.error('-------------------------------------------------------')
          console.error({
            error: data.msg,
            code: data.code,
            order: JSON.stringify({
              symbol: order.symbol,
              side: order.positionSide,
              type: order.type,
              price: order.openPrice,
            }),
          })
          console.error('-------------------------------------------------------')
        }
        return data.code
      }
      const accepted = [
        OrderStatus.New,
        OrderStatus.Filled,
        OrderStatus.PartiallyFilled,
      ] as string[]
      if (!accepted.includes(data.status)) {
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

  async placeMarketOrder(order: Order): Promise<Order | number | null> {
    try {
      const qs = buildPostQs({ ...order, type: OrderType.Market, openPrice: 0, stopPrice: 0 })
      const signature = sign(qs, this.secretKey)
      const headers = { 'X-MBX-APIKEY': this.apiKey }
      const url = `${baseUrl}/v1/order?${qs}&signature=${signature}`
      const res = await fetch(url, { method: 'POST', headers })
      const data: ResponseNewOrder & ResponseError = await res.json()
      if (data.code < 0) {
        console.error('-------------------------------------------------------')
        console.error({
          type: OrderType.Market,
          error: data.msg,
          code: data.code,
          order: JSON.stringify({ symbol: order.symbol, id: order.id }),
        })
        console.error('-------------------------------------------------------')
        return data.code
      }
      const accepted = [
        OrderStatus.New,
        OrderStatus.Filled,
        OrderStatus.PartiallyFilled,
      ] as string[]
      if (!accepted.includes(data.status)) {
        return null
      }
      return {
        ...order,
        type: data.type,
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
        console.error('-------------------------------------------------------')
        console.error({ error: data.msg, code: data.code, symbol, id })
        console.error('-------------------------------------------------------\n')
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
        console.error({ code: data.code, error: data.msg, symbol, id })
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

  async getOpenOrders(symbol: string): Promise<Order[]> {
    try {
      const qs = buildGetQs({ symbol })
      const signature = sign(qs, this.secretKey)
      const headers = { 'X-MBX-APIKEY': this.apiKey }
      const url = `${baseUrl}/v1/openOrders?${qs}&signature=${signature}`
      const res = await fetch(url, { method: 'GET', headers })
      const data: ResponseOrderStatus[] & ResponseError = await res.json()
      if (data.code < 0) {
        console.error({ code: data.code, error: data.msg, symbol })
        return []
      }
      return data.map((d) => ({
        symbol,
        id: d.clientOrderId,
        refId: d.orderId.toString(),
        side: d.side,
        positionSide: d.positionSide,
        type: d.origType,
        status: d.status,
        stopPrice: toNumber(d.stopPrice),
        openPrice: toNumber(d.price),
        closePrice: 0,
        qty: toNumber(d.origQty),
        commission: 0,
        pl: 0,
        openTime: new Date(d.time),
        updateTime: new Date(d.updateTime),
      }))
    } catch (e) {
      console.error(e)
      return []
    }
  }

  async getAllOrders(symbol: string, limit: number): Promise<Order[]> {
    try {
      const qs = buildGetQs({ symbol, limit })
      const signature = sign(qs, this.secretKey)
      const headers = { 'X-MBX-APIKEY': this.apiKey }
      const url = `${baseUrl}/v1/allOrders?${qs}&signature=${signature}`
      const res = await fetch(url, { method: 'GET', headers })
      const data: ResponseOrderStatus[] & ResponseError = await res.json()
      if (data.code < 0) {
        console.error({ code: data.code, error: data.msg, symbol })
        return []
      }
      console.log(data)
      return data.map((d) => ({
        symbol,
        id: d.clientOrderId,
        refId: d.orderId.toString(),
        side: d.side,
        positionSide: d.positionSide,
        type: d.origType,
        status: d.status,
        stopPrice: toNumber(d.stopPrice),
        openPrice: toNumber(d.price),
        closePrice: 0,
        qty: toNumber(d.origQty),
        commission: 0,
        pl: 0,
        openTime: new Date(d.time),
        updateTime: new Date(d.updateTime),
      }))
    } catch (e) {
      console.error(e)
      return []
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
        console.error({ code: data.code, error: data.msg, symbol })
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
        openPrice: toNumber(d.price),
        closePrice: 0,
        qty: toNumber(d.qty),
        commission: toNumber(d.commission),
        commissionAsset: d.commissionAsset,
        pl: toNumber(d.realizedPnl),
        updateTime: new Date(d.time),
      }))
    } catch (e) {
      console.error(e)
      return []
    }
  }

  async getAccountBalance() {
    try {
      const qs = buildGetQs({ symbol: '' })
      const signature = sign(qs, this.secretKey)
      const headers = { 'X-MBX-APIKEY': this.apiKey }
      const url = `${baseUrl}/v2/balance?${qs}&signature=${signature}`
      const res = await fetch(url, { method: 'GET', headers })
      const data: { [key: string]: string }[] & ResponseError = await res.json()
      if (data.code < 0) {
        console.error({ code: data.code, error: data.msg })
        return []
      }
      return data as { [key: string]: string }[]
    } catch (e) {
      console.error(e)
      return []
    }
  }

  async getAccountInfo() {
    try {
      const qs = buildGetQs({ symbol: '' })
      const signature = sign(qs, this.secretKey)
      const headers = { 'X-MBX-APIKEY': this.apiKey }
      const url = `${baseUrl}/v2/account?${qs}&signature=${signature}`
      const res = await fetch(url, { method: 'GET', headers })
      const data: { [key: string]: string | { [key: string]: string }[] } & ResponseError =
        await res.json()
      if (data.code < 0) {
        console.error({ code: data.code, error: data.msg })
        return []
      }
      return data as { [key: string]: string | { [key: string]: string }[] }
    } catch (e) {
      console.error(e)
      return []
    }
  }

  async getTotalUnrealizedProfit() {
    try {
      const data = await this.getAccountInfo()
      return toNumber((data as { [key: string]: string }).totalUnrealizedProfit ?? 0)
    } catch (e) {
      console.error(e)
      return 0
    }
  }

  async getPositionRisks(symbol: string) {
    try {
      const qs = buildGetQs({ symbol })
      const signature = sign(qs, this.secretKey)
      const headers = { 'X-MBX-APIKEY': this.apiKey }
      const url = `${baseUrl}/v2/positionRisk?${qs}&signature=${signature}`
      const res = await fetch(url, { method: 'GET', headers })
      const data: { [key: string]: string }[] & ResponseError = await res.json()
      if (data.code < 0) {
        console.error({ code: data.code, error: data.msg })
        return []
      }
      return data as { [key: string]: string }[]
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
    return []
  } catch {
    return []
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

export async function getTopGainers(n: number): Promise<Candlestick[]> {
  try {
    const items = await getTicker24hr()
    return items
      .filter((i) => i.symbol.indexOf('USDT') > 0 && i.symbol.indexOf('_') < 0 && i.change > 0)
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
      .filter((i) => i.symbol.indexOf('USDT') > 0 && i.symbol.indexOf('_') < 0 && i.change < 0)
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
      .filter((i) => i.symbol.indexOf('USDT') > 0 && i.symbol.indexOf('_') < 0)
      .sort((a, b) => (a.volume < b.volume ? 1 : -1))
      .slice(0, n)
  } catch {
    return []
  }
}

export async function getTopVolumeGainers(
  top: number | Candlestick[],
  n: number
): Promise<Candlestick[]> {
  try {
    const items = Array.isArray(top) ? top : await getTopVolumes(top)
    return items
      .filter((i) => i.change > 0)
      .sort((a, b) => (a.change < b.change ? 1 : -1))
      .slice(0, n)
  } catch {
    return []
  }
}

export async function getTopVolumeLosers(
  top: number | Candlestick[],
  n: number
): Promise<Candlestick[]> {
  try {
    const items = Array.isArray(top) ? top : await getTopVolumes(top)
    return items
      .filter((i) => i.change < 0)
      .sort((a, b) => (a.change > b.change ? 1 : -1))
      .slice(0, n)
  } catch {
    return []
  }
}
