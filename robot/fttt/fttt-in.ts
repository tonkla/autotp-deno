import { connect } from 'https://deno.land/x/redis/mod.ts'

import { RedisKeys } from '../../consts/index.ts'
import { getTopVolumeGainers, getTopVolumeLosers } from '../../exchange/binance/futures.ts'
import { ws24hrTicker, wsCandlestick } from '../../exchange/binance/futures-ws.ts'
import { Interval } from '../../exchange/binance/enums.ts'
import { getHighsLowsCloses } from '../../helper/price.ts'
import talib from '../../talib/talib.ts'
import { HistoricalPrice } from '../../types/index.ts'
import { TaValues } from './types.ts'

const config = {
  exchange: 'binance',
  botId: 1,
}

const redis = await connect({
  hostname: '127.0.0.1',
  port: 6379,
})

const wsList: WebSocket[] = []

async function getTopList() {
  try {
    const size = 2

    const gainers = (await getTopVolumeGainers(30, size)).map((i) => i.symbol)
    await redis.set(`${RedisKeys.TopGainers}-${config.exchange}`, JSON.stringify(gainers))

    const losers = (await getTopVolumeLosers(30, size)).map((i) => i.symbol)
    await redis.set(
      `${RedisKeys.TopLosers}-${config.exchange}`,
      JSON.stringify(losers.filter((i) => !gainers.includes(i)))
    )
  } catch (e) {
    console.error(e.message)
  }
}

async function getHistoricalPrices() {
  closeConnections()

  const gainers = JSON.parse(
    (await redis.get(`${RedisKeys.TopGainers}-${config.exchange}`)) as string
  )
  for (const symbol of gainers) {
    wsList.push(ws24hrTicker(redis, symbol))
    wsList.push(wsCandlestick(redis, symbol, Interval.D1))
    wsList.push(wsCandlestick(redis, symbol, Interval.H4))
    wsList.push(wsCandlestick(redis, symbol, Interval.H1))
  }

  const losers = JSON.parse(
    (await redis.get(`${RedisKeys.TopLosers}-${config.exchange}`)) as string
  )
  for (const symbol of losers) {
    wsList.push(ws24hrTicker(redis, symbol))
    wsList.push(wsCandlestick(redis, symbol, Interval.D1))
    wsList.push(wsCandlestick(redis, symbol, Interval.H4))
    wsList.push(wsCandlestick(redis, symbol, Interval.H1))
  }
}

async function _calculateTaValues() {
  try {
    const gainers = await redis.get(`${RedisKeys.TopGainers}-${config.exchange}`)
    const losers = await redis.get(`${RedisKeys.TopLosers}-${config.exchange}`)

    const symbols = gainers && losers ? [...JSON.parse(gainers), ...JSON.parse(losers)] : []

    for (const tf of [Interval.D1, Interval.H4, Interval.H1]) {
      for (const symbol of symbols) {
        const prices = await redis.get(`${RedisKeys.Candlestick}-${symbol}-${tf}`)
        if (!prices) continue
        const historicalPrices: HistoricalPrice[] = JSON.parse(prices)
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
        await redis.set(`${RedisKeys.TA}-${symbol}-${tf}`, JSON.stringify(values))
      }
    }
  } catch (e) {
    console.error(e)
  }
}

function closeConnections() {
  while (wsList.length > 0) {
    const ws = wsList.pop()
    if (ws) ws.close()
  }
}

function gracefulShutdown() {
  Deno.addSignalListener('SIGINT', () => closeConnections())
  Deno.addSignalListener('SIGTERM', () => closeConnections())
}

async function main() {
  await getTopList()
  await getHistoricalPrices()
  // await calculateTaValues()
  gracefulShutdown()
}

main()
