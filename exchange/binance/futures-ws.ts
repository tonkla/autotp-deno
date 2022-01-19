import { Redis } from 'https://deno.land/x/redis/mod.ts'

import { RedisKeys } from '../../consts/index.ts'
import { toNumber } from '../../helper/number.ts'
import { HistoricalPrice } from '../../types/index.ts'
import { ResponseWs24hrTicker, ResponseWsCandlestick } from './types.ts'

const baseUrl = 'wss://fstream.binance.com/ws'

export function ws24hrTicker(redis: Redis, symbol: string): WebSocket {
  const url = `${baseUrl}/${symbol.toLowerCase()}@ticker`
  const ws = new WebSocket(url)
  ws.onopen = () => console.info(`Open ${url}`)
  ws.onmessage = async ({ data }) => {
    try {
      const d: ResponseWs24hrTicker = JSON.parse(data)
      const p: HistoricalPrice = {
        symbol: d.s,
        openTime: d.O,
        closeTime: d.C,
        open: toNumber(d.o),
        high: toNumber(d.h),
        low: toNumber(d.l),
        close: toNumber(d.c),
        volume: toNumber(d.q),
        change: toNumber(d.P),
      }
      await redis.set(`${RedisKeys.Ticker24hr}-${symbol}`, JSON.stringify(p))
    } catch (e) {
      console.error('ws24hrTicker', e)
    }
  }
  ws.onclose = () => console.info(`Close ${url}`)
  return ws
}

export function wsCandlestick(redis: Redis, symbol: string, interval: string): WebSocket {
  const url = `${baseUrl}/${symbol.toLowerCase()}@kline_${interval}`
  const ws = new WebSocket(url)
  ws.onopen = () => console.info(`Open ${url}`)
  ws.onmessage = async ({ data }) => {
    try {
      const d: ResponseWsCandlestick = JSON.parse(data)
      const p: HistoricalPrice = {
        symbol: d.k.s,
        openTime: d.k.t,
        closeTime: d.k.T,
        open: toNumber(d.k.o),
        high: toNumber(d.k.h),
        low: toNumber(d.k.l),
        close: toNumber(d.k.c),
        volume: toNumber(d.k.q),
        change: 0,
      }
      await redis.set(`${RedisKeys.Candlestick}-${symbol}-${interval}`, JSON.stringify(p))
    } catch (e) {
      console.error('wsCandlestick', e)
    }
  }
  ws.onclose = () => console.info(`Close ${url}`)
  return ws
}
