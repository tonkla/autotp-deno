import { connect } from 'https://deno.land/x/redis@v0.25.4/mod.ts'

import { PostgreSQL } from '../../db/pgbf.ts'
import { RedisKeys, getMarkPrice } from '../../db/redis.ts'
import { Interval } from '../../exchange/binance/enums.ts'
import {
  getBookTicker,
  getOHLCs,
  getTopVolumes,
  getTopVolumeGainers,
  getTopVolumeLosers,
  PrivateApi,
} from '../../exchange/binance/futures.ts'
import { wsOHLC, wsMarkPrice } from '../../exchange/binance/futures-ws.ts'
import { round } from '../../helper/number.ts'
import { calcTfPriceOHLC, getHighsLowsClosesOHLC, getOHLC } from '../../helper/price.ts'
import telegram from '../../service/telegram.ts'
import talib from '../../talib/talib.ts'
import { OHLC, PriceChange, TaValues, TaValuesOHLC, Ticker } from '../../types/index.ts'
import { getConfig } from './config.ts'

const config = await getConfig()

const db = await new PostgreSQL().connect(config.dbUri)

const redis = await connect({ hostname: '127.0.0.1', port: 6379 })

const exchange = new PrivateApi(config.apiKey, config.secretKey)

const wsList: WebSocket[] = []

const SizeD1Candles = 30
const SizeM5Candles = 864
const SizeM1Candles = 60

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
    const list = await getOHLCs(symbol, Interval.M5, SizeM5Candles)
    if (!Array.isArray(list) || list.length !== SizeM5Candles) continue
    await redis.set(RedisKeys.OHLCAll(config.exchange, symbol, Interval.M5), JSON.stringify(list))

    const listd = await getOHLCs(symbol, Interval.D1, SizeD1Candles)
    if (!Array.isArray(listd) || listd.length !== SizeD1Candles) continue
    await redis.set(RedisKeys.OHLCAll(config.exchange, symbol, Interval.D1), JSON.stringify(listd))
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

    wsList.push(
      wsOHLC(
        symbol,
        Interval.M5,
        async (c: OHLC) =>
          await redis.set(
            RedisKeys.OHLCLast(config.exchange, symbol, Interval.M5),
            JSON.stringify(c)
          )
      )
    )

    wsList.push(
      wsOHLC(
        symbol,
        Interval.D1,
        async (c: OHLC) =>
          await redis.set(
            RedisKeys.OHLCLast(config.exchange, symbol, Interval.D1),
            JSON.stringify(c)
          )
      )
    )
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
      const _allCandles = await redis.get(RedisKeys.OHLCAll(config.exchange, symbol, Interval.M5))
      if (!_allCandles) continue
      const allCandles: OHLC[] = JSON.parse(_allCandles)

      const _lastCandle = await redis.get(RedisKeys.OHLCLast(config.exchange, symbol, Interval.M5))
      if (!_lastCandle) continue
      const lastCandle: OHLC = JSON.parse(_lastCandle)
      if ((lastCandle?.h ?? 0) === 0) continue

      const candles: OHLC[] = [...allCandles.slice(0, -1), lastCandle]
      const length = candles.length

      const ohlcs: OHLC[] = []

      if (interval === Interval.D1) {
        const h24 = (24 * 60) / 5
        ohlcs.push(
          getOHLC(candles.slice(length - h24 * 3, length - h24 * 3 + h24)),
          getOHLC(candles.slice(length - h24 * 2, length - h24 * 2 + h24)),
          getOHLC(candles.slice(length - h24))
        )
      } else if (interval === Interval.H12) {
        const h12 = (12 * 60) / 5
        ohlcs.push(
          getOHLC(candles.slice(length - h12 * 3, length - h12 * 3 + h12)),
          getOHLC(candles.slice(length - h12 * 2, length - h12 * 2 + h12)),
          getOHLC(candles.slice(length - h12))
        )
      } else if (interval === Interval.H8) {
        const h8 = (8 * 60) / 5
        ohlcs.push(
          getOHLC(candles.slice(length - h8 * 3, length - h8 * 3 + h8)),
          getOHLC(candles.slice(length - h8 * 2, length - h8 * 2 + h8)),
          getOHLC(candles.slice(length - h8))
        )
      } else if (interval === Interval.H6) {
        const h6 = (6 * 60) / 5
        ohlcs.push(
          getOHLC(candles.slice(length - h6 * 3, length - h6 * 3 + h6)),
          getOHLC(candles.slice(length - h6 * 2, length - h6 * 2 + h6)),
          getOHLC(candles.slice(length - h6))
        )
      } else if (interval === Interval.H4) {
        const h4 = (4 * 60) / 5
        ohlcs.push(
          getOHLC(candles.slice(length - h4 * 3, length - h4 * 3 + h4)),
          getOHLC(candles.slice(length - h4 * 2, length - h4 * 2 + h4)),
          getOHLC(candles.slice(length - h4))
        )
      }

      if (ohlcs.length === 0) continue

      const ohlc_0 = ohlcs.slice(-1)[0]
      const ohlc_1 = ohlcs.slice(-2)[0]
      const ohlc_2 = ohlcs.slice(-3)[0]

      const ratio_0 = round(100 - ((ohlc_0.h - ohlc_0.c) / (ohlc_0.h - ohlc_0.l)) * 100, 2)
      const pc_0 = ratio_0 < 0 ? 0 : ratio_0 > 100 ? 100 : ratio_0

      // const hh_1 = ohlc_1.h > ohlc_0.h ? ohlc_1.h : ohlc_0.h
      // const ll_1 = ohlc_1.l < ohlc_0.l ? ohlc_1.l : ohlc_0.l
      // const ratio_1 = round(100 - ((hh_1 - ohlc_0.c) / (hh_1 - ll_1)) * 100, 2)
      // const pc_1 = ratio_1 < 0 ? 0 : ratio_1 > 100 ? 100 : ratio_1

      // const hh_2 = ohlc_2.h > hh_1 ? ohlc_2.h : hh_1
      // const ll_2 = ohlc_2.l < ll_1 ? ohlc_2.l : ll_1
      // const ratio_2 = round(100 - ((hh_2 - ohlc_0.c) / (hh_2 - ll_2)) * 100, 2)
      // const pc_2 = ratio_2 < 0 ? 0 : ratio_2 > 100 ? 100 : ratio_2

      const atr = (ohlc_0.h - ohlc_0.l + (ohlc_1.h - ohlc_1.l) + (ohlc_2.h - ohlc_2.l)) / 3

      const ta: TaValuesOHLC = {
        o_0: ohlc_0.o,
        h_0: ohlc_0.h,
        l_0: ohlc_0.l,
        c_0: ohlc_0.c,
        o_1: ohlc_1.o,
        h_1: ohlc_1.h,
        l_1: ohlc_1.l,
        c_1: ohlc_1.c,
        o_2: ohlc_2.o,
        h_2: ohlc_2.h,
        l_2: ohlc_2.l,
        c_2: ohlc_2.c,
        pc_0,
        // pc_1,
        // pc_2,
        atr: round(atr, 6),
      }
      await redis.set(RedisKeys.TAOHLC(config.exchange, symbol, interval), JSON.stringify(ta))
    }
  }
}

async function calculateD1TaValues() {
  const symbols = await getSymbols()
  for (const symbol of symbols) {
    const _allCandles = await redis.get(RedisKeys.OHLCAll(config.exchange, symbol, Interval.D1))
    if (!_allCandles) continue
    const allCandles: OHLC[] = JSON.parse(_allCandles)
    if (!Array.isArray(allCandles) || allCandles.length !== config.sizeCandle) continue

    const _lastCandle = await redis.get(RedisKeys.OHLCLast(config.exchange, symbol, Interval.D1))
    if (!_lastCandle) continue
    const lastCandle: OHLC = JSON.parse(_lastCandle)
    if ((lastCandle?.o ?? 0) === 0) continue

    const candlesticks: OHLC[] = [...allCandles.slice(0, -1), lastCandle]
    const [highs, lows, closes] = getHighsLowsClosesOHLC(candlesticks)

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
    await redis.set(RedisKeys.TA(config.exchange, symbol, Interval.D1), JSON.stringify(values))
  }
}

async function fetchM1HistoricalPrices() {
  const symbols = await getSymbols()
  for (const symbol of symbols) {
    const list = await getOHLCs(symbol, Interval.M1, SizeM1Candles)
    if (!Array.isArray(list) || list.length !== SizeM1Candles) continue
    await redis.set(RedisKeys.OHLCAll(config.exchange, symbol, Interval.M1), JSON.stringify(list))
  }
}

async function calculatePriceChanges() {
  const symbols = await getSymbols()
  for (const symbol of symbols) {
    const price = await getMarkPrice(redis, config.exchange, symbol)
    if (price === 0) continue

    const _candles = await redis.get(RedisKeys.OHLCAll(config.exchange, symbol, Interval.M1))
    if (!_candles) continue
    const candles: OHLC[] = JSON.parse(_candles)

    const h1 = calcTfPriceOHLC(candles.slice(), price)
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
  const id3 = setInterval(() => fetchHistoricalPrices(), 300000) // 5m

  await connectWebSockets()
  const id4 = setInterval(() => connectWebSockets(), 605000) // 10m

  await calculateTaValues()
  const id5 = setInterval(() => calculateTaValues(), 2000) // 2s

  await calculateD1TaValues()
  const id6 = setInterval(() => calculateD1TaValues(), 2000) // 2s

  await fetchM1HistoricalPrices()
  const id7 = setInterval(() => fetchM1HistoricalPrices(), 60000) // 1m

  await calculatePriceChanges()
  const id8 = setInterval(() => calculatePriceChanges(), 2000) // 2s

  await fetchBookTickers()
  const id9 = setInterval(() => fetchBookTickers(), 3000) // 3s

  await getOpenPositions()
  const id10 = setInterval(() => getOpenPositions(), 10000) // 10s

  gracefulShutdown([id1, id2, id3, id4, id5, id6, id7, id8, id9, id10])
}

main()
