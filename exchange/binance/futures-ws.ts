import { toNumber } from '../../helper/number.ts'
import {
  AccountPosition,
  BookDepth,
  BookTicker,
  Candlestick,
  OHLC,
  Order,
  Ticker,
  TickerAgg,
} from '../../types/index.ts'

import {
  ResponseWs24hrTicker,
  ResponseWsAccountUpdate,
  ResponseWsAggregateTrade,
  ResponseWsBookDepth,
  ResponseWsBookTicker,
  ResponseWsCandlestick,
  ResponseWsMarkPrice,
  ResponseWsOrderTradeUpdate,
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

export function wsBookDepth(symbol: string, onMessage: (t: BookDepth) => void): WebSocket {
  const url = `${baseUrl}/${symbol.toLowerCase()}@depth10@500ms`
  const ws = new WebSocket(url)
  ws.onopen = () => console.info(`Open ${url}`)
  ws.onmessage = ({ data }) => {
    try {
      const d: ResponseWsBookDepth = JSON.parse(data)
      const t: BookDepth = {
        symbol: d.s,
        time: toNumber(d.T),
        asks: d.a.map((a) => [toNumber(a[0]), toNumber(a[1])]),
        bids: d.b.map((b) => [toNumber(b[0]), toNumber(b[1])]),
        spread: 0,
      }
      t.spread = t.asks[0][0] - t.bids[0][0]
      onMessage(t)
    } catch (e) {
      console.error('wsBookDepth', e)
    }
  }
  ws.onclose = () => console.info(`Close ${url}`)
  return ws
}

// Update real-time
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
        bestAskPrice: toNumber(d.a),
        bestAskQty: toNumber(d.A),
        bestBidPrice: toNumber(d.b),
        bestBidQty: toNumber(d.B),
        spread: 0,
      }
      t.spread = t.bestAskPrice - t.bestBidPrice
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

export function wsOHLC(symbol: string, interval: string, onMessage: (c: OHLC) => void): WebSocket {
  const url = `${baseUrl}/${symbol.toLowerCase()}@kline_${interval}`
  const ws = new WebSocket(url)
  ws.onopen = () => console.info(`Open ${url}`)
  ws.onmessage = ({ data }) => {
    try {
      const d: ResponseWsCandlestick = JSON.parse(data)
      const c: OHLC = {
        o: toNumber(d.k.o),
        h: toNumber(d.k.h),
        l: toNumber(d.k.l),
        c: toNumber(d.k.c),
      }
      onMessage(c)
    } catch (e) {
      console.error('wsHLC', e)
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

export function wsAccountUpdate(
  listenKey: string,
  onMessage: (t: AccountPosition[]) => void
): WebSocket {
  const url = `${baseUrl}/${listenKey}`
  const ws = new WebSocket(url)
  ws.onopen = () => console.info(`Open ${url}`)
  ws.onmessage = ({ data }) => {
    try {
      const d: ResponseWsAccountUpdate = JSON.parse(data)
      if (d?.e === 'ACCOUNT_UPDATE') {
        const positions: AccountPosition[] = []
        for (const p of d?.a?.P) {
          const ap: AccountPosition = {
            symbol: p.s,
            positionAmt: toNumber(p.pa),
            entryPrice: toNumber(p.ep),
            realizedPnL: toNumber(p.cr),
            unrealizedPnL: toNumber(p.up),
            marginType: p.mt,
            isolatedWallet: toNumber(p.iw),
            positionSide: p.ps,
          }
          positions.push(ap)
        }
        onMessage(positions)
      }
    } catch (e) {
      console.error('wsAccountUpdate', e)
    }
  }
  ws.onclose = () => console.info(`Close ${url}`)
  return ws
}

export function wsOrderUpdate(listenKey: string, onMessage: (t: Order) => void): WebSocket {
  const url = `${baseUrl}/${listenKey}`
  const ws = new WebSocket(url)
  ws.onopen = () => console.info(`Open ${url}`)
  ws.onmessage = ({ data }) => {
    try {
      const d: ResponseWsOrderTradeUpdate = JSON.parse(data)
      if (d?.e === 'ORDER_TRADE_UPDATE' && d?.o) {
        const order: Order = {
          botId: '',
          symbol: d.o.s,
          id: d.o.c,
          refId: d.o.i.toString(),
          side: d.o.S,
          positionSide: d.o.ps,
          type: d.o.o,
          status: d.o.X,
          qty: toNumber(d.o.q),
          openPrice: toNumber(d.o.p),
          closePrice: 0,
          commission: d.o.n ? toNumber(d.o.n) : 0,
          commissionAsset: d.o.N ?? '',
          pl: toNumber(d.o.rp),
          updateTime: new Date(d.T),
        }
        onMessage(order)
      }
    } catch (e) {
      console.error('wsOrderUpdate', e)
    }
  }
  ws.onclose = () => console.info(`Close ${url}`)
  return ws
}
