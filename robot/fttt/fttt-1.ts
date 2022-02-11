import { connect } from 'https://deno.land/x/redis@v0.25.2/mod.ts'

import { RedisKeys } from '../../consts/index.ts'
import {
  getCandlesticks,
  getExchangeInfo,
  getTopVolumeGainers,
  getTopVolumeLosers,
} from '../../exchange/binance/futures.ts'
import { ws24hrTicker, wsCandlestick, wsMarkPrice } from '../../exchange/binance/futures-ws.ts'
import { Interval } from '../../exchange/binance/enums.ts'
import { getHighsLowsCloses } from '../../helper/price.ts'
import talib from '../../talib/talib.ts'
import { Candlestick, Ticker } from '../../types/index.ts'
import { getConfig } from './config.ts'
import { TaValues } from './types.ts'

const config = await getConfig()

const redis = await connect({
  hostname: '127.0.0.1',
  port: 6379,
})

const wsList: WebSocket[] = []

async function getSymbolInfos() {
  const infos = (await getExchangeInfo()).map((i) => [i.symbol, i.pricePrecision, i.qtyPrecision])
  await redis.set(RedisKeys.Symbols(config.exchange), JSON.stringify(infos))
}

async function getTopList() {
  const SIZE_TOP = config.sizeN1
  const SIZE_N = config.sizeN2

  const gainers = (await getTopVolumeGainers(SIZE_TOP, SIZE_N)).map((i) => i.symbol)
  await redis.set(RedisKeys.TopGainers(config.exchange), JSON.stringify(gainers))

  const losers = (await getTopVolumeLosers(SIZE_TOP, SIZE_N)).map((i) => i.symbol)
  await redis.set(RedisKeys.TopLosers(config.exchange), JSON.stringify(losers))
}

async function getSymbols(): Promise<string[]> {
  const symbols: string[] = []

  const _gainers = await redis.get(RedisKeys.TopGainers(config.exchange))
  if (_gainers) {
    const gainers = JSON.parse(_gainers)
    if (Array.isArray(gainers)) symbols.push(...gainers)
  }

  const _losers = await redis.get(RedisKeys.TopLosers(config.exchange))
  if (_losers) {
    const losers = JSON.parse(_losers)
    if (Array.isArray(losers)) symbols.push(...losers)
  }

  return symbols
}

async function connectRestApis() {
  const symbols = await getSymbols()
  for (const symbol of symbols) {
    for (const interval of [Interval.D1]) {
      await redis.set(
        RedisKeys.CandlestickAll(config.exchange, symbol, interval),
        JSON.stringify(await getCandlesticks(symbol, interval, config.sizeN1))
      )
    }
  }
}

async function connectWebSockets() {
  await closeConnections()
  const symbols = await getSymbols()
  for (const symbol of symbols) {
    wsList.push(
      ws24hrTicker(
        symbol,
        async (c: Candlestick) =>
          await redis.set(RedisKeys.Ticker24hr(config.exchange, symbol), JSON.stringify(c))
      )
    )
    wsList.push(
      wsMarkPrice(
        symbol,
        async (t: Ticker) =>
          await redis.set(RedisKeys.MarkPrice(config.exchange, symbol), JSON.stringify(t))
      )
    )
    for (const interval of [Interval.D1]) {
      wsList.push(
        wsCandlestick(
          symbol,
          interval,
          async (c: Candlestick) =>
            await redis.set(
              RedisKeys.CandlestickLast(config.exchange, symbol, interval),
              JSON.stringify(c)
            )
        )
      )
    }
  }
}

async function calculateTaValues() {
  const symbols = await getSymbols()
  for (const symbol of symbols) {
    for (const interval of [Interval.D1]) {
      const _allCandles = await redis.get(
        RedisKeys.CandlestickAll(config.exchange, symbol, interval)
      )
      if (!_allCandles) continue
      const allCandles = JSON.parse(_allCandles)
      if (!Array.isArray(allCandles)) continue

      const _lastCandle = await redis.get(
        RedisKeys.CandlestickLast(config.exchange, symbol, interval)
      )
      if (!_lastCandle) continue
      const lastCandle: Candlestick = JSON.parse(_lastCandle)
      if ((lastCandle?.open ?? 0) === 0) continue

      const candlesticks: Candlestick[] = [...allCandles.slice(0, -1), lastCandle]
      const [highs, lows, closes] = getHighsLowsCloses(candlesticks)
      const length = candlesticks.length

      const h_0 = highs[length - 1]
      const h_1 = highs[length - 2]
      const h_2 = highs[length - 3]
      const l_0 = lows[length - 1]
      const l_1 = lows[length - 2]
      const l_2 = lows[length - 3]
      const c_0 = closes[length - 1]
      const c_1 = closes[length - 2]
      const c_2 = closes[length - 3]

      const hma = talib.WMA(highs, config.maPeriod)
      const lma = talib.WMA(lows, config.maPeriod)
      const cma = talib.WMA(closes, config.maPeriod)

      const hma_0 = hma[length - 1]
      const hma_1 = hma[length - 2]
      const lma_0 = lma[length - 1]
      const lma_1 = lma[length - 2]
      const cma_0 = cma[length - 1]
      const cma_1 = cma[length - 2]
      const atr = hma_0 - lma_0

      const values: TaValues = {
        h_0,
        h_1,
        h_2,
        l_0,
        l_1,
        l_2,
        c_0,
        c_1,
        c_2,
        hma_0,
        hma_1,
        lma_0,
        lma_1,
        cma_0,
        cma_1,
        atr,
      }
      await redis.set(RedisKeys.TA(config.exchange, symbol, interval), JSON.stringify(values))
    }
  }
}

function closeConnections(): Promise<boolean> {
  while (wsList.length > 0) {
    const ws = wsList.pop()
    if (ws) ws.close()
  }
  return new Promise((resolve) => resolve(true))
}

function clean(intervalIds: number[]) {
  for (const id of intervalIds) {
    clearInterval(id)
  }
  while (wsList.length > 0) {
    const ws = wsList.pop()
    if (ws) ws.close()
  }
  redis.close()
}

function gracefulShutdown(intervalIds: number[]) {
  Deno.addSignalListener('SIGINT', () => clean(intervalIds))
  Deno.addSignalListener('SIGTERM', () => clean(intervalIds))
}

async function main() {
  await getSymbolInfos()
  const id0 = setInterval(() => getSymbolInfos(), 3611000) // 1h

  await getTopList()
  const id1 = setInterval(() => getTopList(), 600000) // 10m

  await connectRestApis()
  const id2 = setInterval(() => connectRestApis(), 602000) // 10m

  await connectWebSockets()
  const id3 = setInterval(() => connectWebSockets(), 604000) // 10m

  await calculateTaValues()
  const id4 = setInterval(() => calculateTaValues(), 2000) // 2s

  gracefulShutdown([id0, id1, id2, id3, id4])
}

main()
