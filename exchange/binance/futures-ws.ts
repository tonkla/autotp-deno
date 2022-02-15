import { toNumber } from '../../helper/number.ts'
import { BookTicker, Candlestick, Ticker, TickerAgg } from '../../types/index.ts'
import {
  ResponseWs24hrTicker,
  ResponseWsBookTicker,
  ResponseWsCandlestick,
  ResponseWsMarkPrice,
  ResponseWsAggregateTrade,
} from './types.ts'

const baseUrl = 'wss://fstream.binance.com/ws'

export function ws24hrTicker(symbol: string, onMessage: (p: Candlestick) => void): WebSocket {
  const url = `${baseUrl}/${symbol.toLowerCase()}@ticker`
  const ws = new WebSocket(url)
  ws.onopen = () => console.info(`Open ${url}`)
  ws.onmessage = ({ data }) => {
    try {
      const d: ResponseWs24hrTicker = JSON.parse(data)
      const c: Candlestick = {
        symbol: d.s,
        openTime: d.O,
        closeTime: d.C,
        open: toNumber(d.o),
        high: toNumber(d.h),
        low: toNumber(d.l),
        close: toNumber(d.c),
        volume: toNumber(d.q),
        change: toNumber(d.P),
        time: d.E,
      }
      onMessage(c)
    } catch (e) {
      console.error('ws24hrTicker', e)
    }
  }
  ws.onclose = () => console.info(`Close ${url}`)
  return ws
}

export function wsBookTicker(symbol: string, onMessage: (t: BookTicker) => void): WebSocket {
  const url = `${baseUrl}/${symbol.toLowerCase()}@bookTicker`
  const ws = new WebSocket(url)
  ws.onopen = () => console.info(`Open ${url}`)
  ws.onmessage = ({ data }) => {
    try {
      const d: ResponseWsBookTicker = JSON.parse(data)
      const t: BookTicker = {
        symbol: d.s,
        time: toNumber(d.T),
        bestBidPrice: toNumber(d.b),
        bestBidQty: toNumber(d.B),
        bestAskPrice: toNumber(d.a),
        bestAskQty: toNumber(d.A),
      }
      onMessage(t)
    } catch (e) {
      console.error('wsBookTicker', e)
    }
  }
  ws.onclose = () => console.info(`Close ${url}`)
  return ws
}

export function wsCandlestick(
  symbol: string,
  interval: string,
  onMessage: (c: Candlestick) => void
): WebSocket {
  const url = `${baseUrl}/${symbol.toLowerCase()}@kline_${interval}`
  const ws = new WebSocket(url)
  ws.onopen = () => console.info(`Open ${url}`)
  ws.onmessage = ({ data }) => {
    try {
      const d: ResponseWsCandlestick = JSON.parse(data)
      const c: Candlestick = {
        symbol: d.k.s,
        openTime: d.k.t,
        closeTime: d.k.T,
        open: toNumber(d.k.o),
        high: toNumber(d.k.h),
        low: toNumber(d.k.l),
        close: toNumber(d.k.c),
        volume: toNumber(d.k.q),
        change: 0,
        time: d.E,
      }
      onMessage(c)
    } catch (e) {
      console.error('wsCandlestick', e)
    }
  }
  ws.onclose = () => console.info(`Close ${url}`)
  return ws
}

export function wsMarkPrice(symbol: string, onMessage: (t: Ticker) => void): WebSocket {
  const url = `${baseUrl}/${symbol.toLowerCase()}@markPrice@1s`
  const ws = new WebSocket(url)
  ws.onopen = () => console.info(`Open ${url}`)
  ws.onmessage = ({ data }) => {
    try {
      const d: ResponseWsMarkPrice = JSON.parse(data)
      const t: Ticker = {
        symbol: d.s,
        price: toNumber(d.p),
        time: toNumber(d.E),
      }
      onMessage(t)
    } catch (e) {
      console.error('wsMarkPrice', e)
    }
  }
  ws.onclose = () => console.info(`Close ${url}`)
  return ws
}

export function wsAggregateTrade(symbol: string, onMessage: (t: TickerAgg) => void): WebSocket {
  const url = `${baseUrl}/${symbol.toLowerCase()}@aggTrade`
  const ws = new WebSocket(url)
  ws.onopen = () => console.info(`Open ${url}`)
  ws.onmessage = ({ data }) => {
    try {
      const d: ResponseWsAggregateTrade = JSON.parse(data)
      const t: TickerAgg = {
        symbol: d.s,
        price: toNumber(d.p),
        time: toNumber(d.E),
        qty: toNumber(d.q),
      }
      onMessage(t)
    } catch (e) {
      console.error('wsAggregateTrade', e)
    }
  }
  ws.onclose = () => console.info(`Close ${url}`)
  return ws
}
