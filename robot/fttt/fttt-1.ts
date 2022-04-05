import { connect } from 'https://deno.land/x/redis@v0.25.4/mod.ts'

import { PostgreSQL } from '../../db/pgbf.ts'
import { RedisKeys, getMarkPrice } from '../../db/redis.ts'
import { Interval } from '../../exchange/binance/enums.ts'
import {
  getBookTicker,
  getCandlesticks,
  getTopVolumes,
  getTopVolumeGainers,
  getTopVolumeLosers,
  PrivateApi,
} from '../../exchange/binance/futures.ts'
import { wsCandlestick, wsMarkPrice } from '../../exchange/binance/futures-ws.ts'
import { round } from '../../helper/number.ts'
import { calcTfPrice, getHighsLowsCloses } from '../../helper/price.ts'
import telegram from '../../service/telegram.ts'
import talib from '../../talib/talib.ts'
import { Candlestick, PriceChange, TaValues, Ticker } from '../../types/index.ts'
import { getConfig } from './config.ts'

const config = await getConfig()

const db = await new PostgreSQL().connect(config.dbUri)

const redis = await connect({ hostname: '127.0.0.1', port: 6379 })

const exchange = new PrivateApi(config.apiKey, config.secretKey)

const wsList: WebSocket[] = []

async function getTopList() {
  await redis.flushdb()

  const topVols = await getTopVolumes(config.sizeTopVol)

  const _topVols = topVols.filter((t) => !config.excluded.includes(t.symbol))
  await redis.set(RedisKeys.TopVols(config.exchange), JSON.stringify(_topVols.map((i) => i.symbol)))

  const gainers = (await getTopVolumeGainers(topVols, config.sizeTopChg)).map((i) => i.symbol)
  await redis.set(RedisKeys.TopGainers(config.exchange), JSON.stringify(gainers))

  const losers = (await getTopVolumeLosers(topVols, config.sizeTopChg)).map((i) => i.symbol)
  await redis.set(RedisKeys.TopLosers(config.exchange), JSON.stringify(losers))
}

async function getSymbols(): Promise<string[]> {
  const orders = await db.getAllOpenOrders()
  const symbols: string[] = orders.map((o) => o.symbol)

  const _topVols = await redis.get(RedisKeys.TopVols(config.exchange))
  if (_topVols) {
    const topVols = JSON.parse(_topVols)
    if (Array.isArray(topVols)) symbols.push(...topVols)
  }

  return [...new Set(symbols)]
}

async function fetchHistoricalPrices() {
  const symbols = await getSymbols()
  for (const symbol of symbols) {
    for (const interval of config.timeframes) {
      await redis.set(
        RedisKeys.CandlestickAll(config.exchange, symbol, interval),
        JSON.stringify(await getCandlesticks(symbol, interval, config.sizeCandle))
      )
    }
  }
}

async function connectWebSockets() {
  await closeConnections()
  const symbols = await getSymbols()
  for (const symbol of symbols) {
    wsList.push(
      wsMarkPrice(
        symbol,
        async (t: Ticker) =>
          await redis.set(RedisKeys.MarkPrice(config.exchange, symbol), JSON.stringify(t))
      )
    )
    for (const interval of config.timeframes) {
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
  wsList.push(
    wsMarkPrice(
      'BNBUSDT',
      async (t: Ticker) =>
        await redis.set(RedisKeys.MarkPrice(config.exchange, 'BNBUSDT'), JSON.stringify(t))
    )
  )
}

async function calculateTaValues() {
  const symbols = await getSymbols()
  for (const symbol of symbols) {
    for (const interval of config.timeframes) {
      const _allCandles = await redis.get(
        RedisKeys.CandlestickAll(config.exchange, symbol, interval)
      )
      if (!_allCandles) continue
      const allCandles: Candlestick[] = JSON.parse(_allCandles)
      if (!Array.isArray(allCandles) || allCandles.length !== config.sizeCandle) continue

      const _lastCandle = await redis.get(
        RedisKeys.CandlestickLast(config.exchange, symbol, interval)
      )
      if (!_lastCandle) continue
      const lastCandle: Candlestick = JSON.parse(_lastCandle)
      if ((lastCandle?.open ?? 0) === 0) continue

      const candlesticks: Candlestick[] = [...allCandles.slice(0, -1), lastCandle]
      const [highs, lows, closes] = getHighsLowsCloses(candlesticks)

      const h_0 = highs.slice(-1)[0]
      const h_1 = highs.slice(-2)[0]
      const h_2 = highs.slice(-3)[0]
      const l_0 = lows.slice(-1)[0]
      const l_1 = lows.slice(-2)[0]
      const l_2 = lows.slice(-3)[0]
      const c_0 = closes.slice(-1)[0]
      const c_1 = closes.slice(-2)[0]

      const hma = talib.WMA(highs, config.maPeriod)
      const lma = talib.WMA(lows, config.maPeriod)
      const cma = talib.WMA(closes, config.maPeriod)

      const hma_0 = hma.slice(-1)[0]
      const hma_1 = hma.slice(-2)[0]
      const lma_0 = lma.slice(-1)[0]
      const lma_1 = lma.slice(-2)[0]
      const cma_0 = cma.slice(-1)[0]
      const cma_1 = cma.slice(-2)[0]

      const atr = hma_0 - lma_0
      const slope = (cma_0 - cma_1) / atr

      const values: TaValues = {
        openTime: lastCandle.openTime,
        closeTime: lastCandle.closeTime,
        h_0,
        h_1,
        h_2,
        l_0,
        l_1,
        l_2,
        c_0,
        c_1,
        hma_0,
        hma_1,
        lma_0,
        lma_1,
        cma_0,
        cma_1,
        atr,
        slope,
      }
      await redis.set(RedisKeys.TA(config.exchange, symbol, interval), JSON.stringify(values))
    }
  }
}

const SizeM1Candles = 60
async function fetchM1HistoricalPrices() {
  const symbols = await getSymbols()
  for (const symbol of symbols) {
    await redis.set(
      RedisKeys.CandlestickAll(config.exchange, symbol, Interval.M1),
      JSON.stringify(await getCandlesticks(symbol, Interval.M1, SizeM1Candles))
    )
  }
}

async function calculatePriceChanges() {
  const symbols = await getSymbols()
  for (const symbol of symbols) {
    const price = await getMarkPrice(redis, config.exchange, symbol)
    if (price === 0) continue

    const _candles = await redis.get(RedisKeys.CandlestickAll(config.exchange, symbol, Interval.M1))
    if (!_candles) continue
    const candles: Candlestick[] = JSON.parse(_candles)
    if (!Array.isArray(candles) || candles.length !== SizeM1Candles) continue

    // const h24 = calcTfPrice(candles.slice(), mp.price, ta.atr)

    // const utcIdx = candles.findIndex((c) => {
    //   const t1 = new Date(c.openTime).toISOString().split('T')[1].split(':')
    //   const t2 = new Date().toISOString().split('T')[1].split(':')
    //   return (
    //     (new Date(c.openTime).getDate() === new Date().getDate() || toNumber(t2[0]) >= 17) &&
    //     t1[0] === '00' &&
    //     t1[1] === '00'
    //   )
    // })
    // const utc = calcTfPrice(candles.slice(utcIdx), mp.price, ta.atr)

    // 5 * 96 = 8 * 60
    // const h8 = calcTfPrice(candles.slice(candles.length - 96), mp.price, ta.atr)
    // 5 * 72 = 6 * 60
    // const h6 = calcTfPrice(candles.slice(candles.length - 72), mp.price, ta.atr)
    // 5 * 48 = 4 * 60
    // const h4 = calcTfPrice(candles.slice(candles.length - 48), mp.price, ta.atr)
    // 5 * 24 = 2 * 60
    // const h2 = calcTfPrice(candles.slice(candles.length - 24), mp.price, ta.atr)
    // 5 * 12 = 60
    // const h1 = calcTfPrice(candles.slice(candles.length - 12), mp.price, ta.atr)
    const h1 = calcTfPrice(candles.slice(), price)
    // 5 * 6 = 30
    // const m30 = calcTfPrice(candles.slice(candles.length - 6), mp.price, ta.atr)
    // 5 * 3 = 15
    // const m15 = calcTfPrice(candles.slice(candles.length - 3), mp.price, ta.atr)

    // const change: PriceChange = { h8, h6, h4, h2, h1, m30, m15 }
    const change: PriceChange = { h1 }

    await redis.set(RedisKeys.PriceChange(config.exchange, symbol), JSON.stringify(change))
  }
}

async function fetchBookTickers() {
  const symbols = await getSymbols()
  for (const symbol of symbols) {
    const bt = await getBookTicker(symbol)
    if (!bt) continue
    await redis.set(RedisKeys.BookTicker(config.exchange, symbol), JSON.stringify(bt))
  }
}

async function getOpenPositions() {
  const orders = await db.getAllOpenOrders()
  if (orders.length === 0) return
  const positions = await exchange.getOpenPositions()
  for (const o of orders) {
    if (!o.positionSide) continue
    const pos = positions.find((p) => p.symbol === o.symbol && p.positionSide === o.positionSide)
    if (!pos) continue
    await redis.set(
      RedisKeys.Position(config.exchange, o.symbol, o.positionSide),
      JSON.stringify(pos)
    )
  }
}

async function log() {
  if (new Date().getMinutes() % 30 !== 0) return
  const account = await exchange.getAccountInfo()
  if (!account) return
  const pl = round(account.totalUnrealizedProfit, 4)
  const margin = round(account.totalMarginBalance, 4)
  const wallet = round(account.totalWalletBalance, 4)
  const msg = `*PROFIT*: \`${pl}\`
*MARGIN*: \`${margin}\`
*WALLET*: \`${wallet}\``
  await telegram.sendMessage(config.telegramBotToken, config.telegramChatId, msg, true)
}

function closeConnections(): Promise<boolean> {
  while (wsList.length > 0) {
    const ws = wsList.pop()
    if (ws) ws.close()
  }
  return Promise.resolve(true)
}

function clean(intervalIds: number[]) {
  for (const id of intervalIds) {
    clearInterval(id)
  }
  while (wsList.length > 0) {
    const ws = wsList.pop()
    if (ws) ws.close()
  }
  db.close()
}

function gracefulShutdown(intervalIds: number[]) {
  Deno.addSignalListener('SIGINT', () => clean(intervalIds))
  Deno.addSignalListener('SIGTERM', () => clean(intervalIds))
}

async function main() {
  await log()
  const id1 = setInterval(() => log(), 60000) // 1m

  await getTopList()
  const id2 = setInterval(() => getTopList(), 600000) // 10m

  await fetchHistoricalPrices()
  const id3 = setInterval(() => fetchHistoricalPrices(), 60000) // 1m

  await connectWebSockets()
  const id4 = setInterval(() => connectWebSockets(), 605000) // 10m

  await calculateTaValues()
  const id5 = setInterval(() => calculateTaValues(), 2000) // 2s

  await fetchM1HistoricalPrices()
  const id6 = setInterval(() => fetchM1HistoricalPrices(), 60000) // 1m

  await calculatePriceChanges()
  const id7 = setInterval(() => calculatePriceChanges(), 2000) // 2s

  await fetchBookTickers()
  const id8 = setInterval(() => fetchBookTickers(), 2000) // 2s

  await getOpenPositions()
  const id9 = setInterval(() => getOpenPositions(), 10000) // 10s

  gracefulShutdown([id1, id2, id3, id4, id5, id6, id7, id8, id9])
}

main()
