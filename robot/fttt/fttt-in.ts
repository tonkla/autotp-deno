import { connect } from 'https://deno.land/x/redis/mod.ts'

import { RedisKeys } from '../../consts/index.ts'
import {
  getHistoricalPrices,
  getTopVolumeGainers,
  getTopVolumeLosers,
} from '../../exchange/binance/futures.ts'
import { ws24hrTicker, wsCandlestick } from '../../exchange/binance/futures-ws.ts'
import { Interval } from '../../exchange/binance/enums.ts'
import { getHighsLowsCloses } from '../../helper/price.ts'
import talib from '../../talib/talib.ts'
import { HistoricalPrice } from '../../types/index.ts'
import { TaValues } from './types.ts'

const config = {
  exchange: 'bn',
  botId: 1,
}

const redis = await connect({
  hostname: '127.0.0.1',
  port: 6379,
})

const wsList: WebSocket[] = []

async function getTopList() {
  try {
    const SIZE_TOP = 30
    const SIZE_N = 1

    const gainers = (await getTopVolumeGainers(SIZE_TOP, SIZE_N)).map((i) => i.symbol)
    await redis.set(RedisKeys.TopGainers(config.exchange), JSON.stringify(gainers))

    const losers = (await getTopVolumeLosers(SIZE_TOP, SIZE_N)).map((i) => i.symbol)
    await redis.set(RedisKeys.TopLosers(config.exchange), JSON.stringify(losers))
  } catch (e) {
    console.error(e)
  }
}

async function getAllCandlesticks() {
  const SIZE_N = 30

  const _gainers = await redis.get(RedisKeys.TopGainers(config.exchange))
  if (_gainers) {
    const gainers = JSON.parse(_gainers)
    for (const symbol of gainers) {
      await redis.set(
        RedisKeys.CandlestickAll(config.exchange, symbol, Interval.D1),
        JSON.stringify(await getHistoricalPrices(symbol, Interval.D1, SIZE_N))
      )
      await redis.set(
        RedisKeys.CandlestickAll(config.exchange, symbol, Interval.H4),
        JSON.stringify(await getHistoricalPrices(symbol, Interval.H4, SIZE_N))
      )
      await redis.set(
        RedisKeys.CandlestickAll(config.exchange, symbol, Interval.H1),
        JSON.stringify(await getHistoricalPrices(symbol, Interval.H1, SIZE_N))
      )
    }
  }

  const _losers = await redis.get(RedisKeys.TopLosers(config.exchange))
  if (_losers) {
    const losers = JSON.parse(_losers)
    for (const symbol of losers) {
      await redis.set(
        RedisKeys.CandlestickAll(config.exchange, symbol, Interval.D1),
        JSON.stringify(await getHistoricalPrices(symbol, Interval.D1, SIZE_N))
      )
      await redis.set(
        RedisKeys.CandlestickAll(config.exchange, symbol, Interval.H4),
        JSON.stringify(await getHistoricalPrices(symbol, Interval.H4, SIZE_N))
      )
      await redis.set(
        RedisKeys.CandlestickAll(config.exchange, symbol, Interval.H1),
        JSON.stringify(await getHistoricalPrices(symbol, Interval.H1, SIZE_N))
      )
    }
  }
}

async function getLastCandlesticks() {
  await closeConnections()

  const _gainers = await redis.get(RedisKeys.TopGainers(config.exchange))
  if (_gainers) {
    const gainers = JSON.parse(_gainers)
    for (const symbol of gainers) {
      wsList.push(ws24hrTicker(redis, symbol))
      wsList.push(wsCandlestick(redis, symbol, Interval.D1))
      wsList.push(wsCandlestick(redis, symbol, Interval.H4))
      wsList.push(wsCandlestick(redis, symbol, Interval.H1))
    }
  }

  const _losers = await redis.get(RedisKeys.TopLosers(config.exchange))
  if (_losers) {
    const losers = JSON.parse(_losers)
    for (const symbol of losers) {
      wsList.push(ws24hrTicker(redis, symbol))
      wsList.push(wsCandlestick(redis, symbol, Interval.D1))
      wsList.push(wsCandlestick(redis, symbol, Interval.H4))
      wsList.push(wsCandlestick(redis, symbol, Interval.H1))
    }
  }
}

async function calculateTaValues() {
  try {
    const gainers = await redis.get(RedisKeys.TopGainers(config.exchange))
    const losers = await redis.get(RedisKeys.TopLosers(config.exchange))

    const symbols = [
      ...(gainers ? [...JSON.parse(gainers)] : []),
      ...(losers ? [...JSON.parse(losers)] : []),
    ]

    for (const interval of [Interval.D1, Interval.H4, Interval.H1]) {
      for (const symbol of symbols) {
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
        const lastCandle = JSON.parse(_lastCandle)

        const historicalPrices: HistoricalPrice[] = [...allCandles.slice(0, -1), lastCandle]

        const [highs, lows, closes] = getHighsLowsCloses(historicalPrices)

        const length = historicalPrices.length

        const h_0 = highs[length - 1]
        const h_1 = highs[length - 2]
        const h_2 = highs[length - 3]
        const l_0 = lows[length - 1]
        const l_1 = lows[length - 2]
        const l_2 = lows[length - 3]

        const hma = talib.WMA(highs, 8)
        const lma = talib.WMA(lows, 8)
        const cma = talib.WMA(closes, 8)

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
  } catch (e) {
    console.error(e)
  }
}

function closeConnections(): Promise<boolean> {
  while (wsList.length > 0) {
    const ws = wsList.pop()
    if (ws) ws.close()
  }
  return new Promise((resolve) => resolve(true))
}

function clean(intervalId: number) {
  clearInterval(intervalId)

  while (wsList.length > 0) {
    const ws = wsList.pop()
    if (ws) ws.close()
  }
}

function gracefulShutdown(intervalId: number) {
  Deno.addSignalListener('SIGINT', () => clean(intervalId))
  Deno.addSignalListener('SIGTERM', () => clean(intervalId))
}

async function main() {
  await getTopList()
  await getAllCandlesticks()
  await getLastCandlesticks()
  await calculateTaValues()

  const intervalId = setInterval(async () => await calculateTaValues(), 3000)

  gracefulShutdown(intervalId)
}

main()
