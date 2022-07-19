import { datetime, redis } from '../../deps.ts'

import { RedisKeys } from '../../db/redis.ts'
import { wsCandlestick, wsMarkPrice } from '../../exchange/binance/futures-ws.ts'
import { getBookTicker, getCandlesticks, PrivateApi } from '../../exchange/binance/futures.ts'
import { round } from '../../helper/number.ts'
import { calcSlopes, getHLCs } from '../../helper/price.ts'
import telegram from '../../service/telegram.ts'
import talib from '../../talib/talib.ts'
import { Candlestick, Ticker } from '../../types/index.ts'
import { TaValues } from '../type.ts'
import { getConfig } from './config.ts'

const config = await getConfig()

const redisc = await redis.connect({ hostname: '127.0.0.1', port: 6379 })

const exchange = new PrivateApi(config.apiKey, config.secretKey)

const wsList: WebSocket[] = []

function getSymbols() {
  return config.included
}

async function log() {
  // if (Date.now()) return
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

async function fetchHistoricalPrices() {
  const symbols = getSymbols()
  for (const symbol of symbols) {
    for (const interval of config.timeframes) {
      await redisc.set(
        RedisKeys.CandlestickAll(config.exchange, symbol, interval),
        JSON.stringify(await getCandlesticks(symbol, interval, config.sizeCandle))
      )
    }
  }
}

async function connectWebSockets() {
  await closeConnections()
  const symbols = getSymbols()
  for (const symbol of symbols) {
    wsList.push(
      wsMarkPrice(
        symbol,
        async (t: Ticker) =>
          await redisc.set(RedisKeys.MarkPrice(config.exchange, symbol), JSON.stringify(t))
      )
    )
    for (const interval of config.timeframes) {
      wsList.push(
        wsCandlestick(
          symbol,
          interval,
          async (c: Candlestick) =>
            await redisc.set(
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
        await redisc.set(RedisKeys.MarkPrice(config.exchange, 'BNBUSDT'), JSON.stringify(t))
    )
  )
}

async function calculateTaValues() {
  const symbols = getSymbols()
  for (const symbol of symbols) {
    for (const interval of config.timeframes) {
      const _ac = await redisc.get(RedisKeys.CandlestickAll(config.exchange, symbol, interval))
      if (!_ac) continue
      const allCandles: Candlestick[] = JSON.parse(_ac)
      if (!Array.isArray(allCandles) || allCandles.length !== config.sizeCandle) continue

      const _lc = await redisc.get(RedisKeys.CandlestickLast(config.exchange, symbol, interval))
      if (!_lc) continue
      const lastCandle: Candlestick = JSON.parse(_lc)
      if ((lastCandle?.open ?? 0) === 0) continue

      const candles: Candlestick[] = [...allCandles.slice(0, -1), lastCandle]
      const [highs, lows, closes] = getHLCs(candles)

      const hma = talib.WMA(highs, config.maPeriod)
      const lma = talib.WMA(lows, config.maPeriod)
      const cma = talib.WMA(closes, config.maPeriod)

      const hma_0 = hma.slice(-1)[0]
      const lma_0 = lma.slice(-1)[0]
      const cma_0 = cma.slice(-1)[0]
      const atr = hma_0 - lma_0

      const hsl = calcSlopes(hma, atr)
      const lsl = calcSlopes(lma, atr)
      const csl = calcSlopes(cma, atr)

      const hsl_0 = hsl.slice(-1)[0]
      const lsl_0 = lsl.slice(-1)[0]
      const csl_0 = csl.slice(-1)[0]

      // const t_0 = lastCandle.openTime
      const h_0 = lastCandle.high
      const l_0 = lastCandle.low
      const c_0 = lastCandle.close

      const cd_1 = candles.slice(-2)[0]
      const h_1 = cd_1.high
      const l_1 = cd_1.low
      const c_1 = cd_1.close

      // const _hl_0 = h_0 - l_0
      // const hl_0 = (_hl_0 / atr) * 100
      // const hc_0 = ((h_0 - c_0) / _hl_0) * 100
      // const cl_0 = ((c_0 - l_0) / _hl_0) * 100
      // const co_0 = ((c_0 - o_0) / _hl_0) * 100

      const values: TaValues = {
        // t_0,
        h_0,
        l_0,
        c_0,
        h_1,
        l_1,
        c_1,
        // hl_0,
        // hc_0,
        // cl_0,
        // co_0,
        hma_0,
        lma_0,
        cma_0,
        hsl_0,
        lsl_0,
        csl_0,
        atr,
      }
      await redisc.set(RedisKeys.TA(config.exchange, symbol, interval), JSON.stringify(values))
    }
  }
}

async function fetchBookTickers() {
  const symbols = getSymbols()
  for (const symbol of symbols) {
    const bt = await getBookTicker(symbol)
    if (!bt) continue
    await redisc.set(RedisKeys.BookTicker(config.exchange, symbol), JSON.stringify(bt))
  }
}

async function getOpenPositions() {
  if (Date.now()) return
  const symbols = getSymbols()
  for (const symbol of symbols) {
    const positions = await exchange.getOpenPositions()
    for (const pos of positions) {
      if (pos.symbol !== symbol) continue
      await redisc.set(
        RedisKeys.Position(config.exchange, pos.symbol, pos.positionSide),
        JSON.stringify(pos)
      )
    }
    await redisc.set(RedisKeys.Positions(config.exchange), JSON.stringify(positions))
  }
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
}

function gracefulShutdown(intervalIds: number[]) {
  Deno.addSignalListener('SIGINT', () => clean(intervalIds))
  Deno.addSignalListener('SIGTERM', () => clean(intervalIds))
}

async function feeder() {
  await log()
  const id1 = setInterval(() => log(), datetime.MINUTE)

  await fetchHistoricalPrices()
  const id2 = setInterval(() => fetchHistoricalPrices(), datetime.MINUTE)

  await connectWebSockets()
  const id3 = setInterval(() => connectWebSockets(), 10 * datetime.MINUTE)

  await calculateTaValues()
  const id4 = setInterval(() => calculateTaValues(), 5 * datetime.SECOND)

  await fetchBookTickers()
  const id5 = setInterval(() => fetchBookTickers(), 5 * datetime.SECOND)

  const id6 = setInterval(() => getOpenPositions(), 10 * datetime.SECOND)

  gracefulShutdown([id1, id2, id3, id4, id5, id6])
}

feeder()
