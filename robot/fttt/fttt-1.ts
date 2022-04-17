import { connect } from 'https://deno.land/x/redis@v0.25.4/mod.ts'

import { PostgreSQL } from '../../db/pgbf.ts'
import { RedisKeys } from '../../db/redis.ts'
import {
  getBookTicker,
  getCandlesticks,
  getTopVolumes,
  PrivateApi,
} from '../../exchange/binance/futures.ts'
import { wsCandlestick, wsMarkPrice } from '../../exchange/binance/futures-ws.ts'
import { round } from '../../helper/number.ts'
import { getHighsLows } from '../../helper/price.ts'
import telegram from '../../service/telegram.ts'
import talib from '../../talib/talib.ts'
import { Candlestick, TaValuesMini, Ticker } from '../../types/index.ts'
import { getConfig } from './config.ts'

const config = await getConfig()

const db = await new PostgreSQL().connect(config.dbUri)

const redis = await connect({ hostname: '127.0.0.1', port: 6379 })

const exchange = new PrivateApi(config.apiKey, config.secretKey)

const wsList: WebSocket[] = []

const ATR_OPEN = 0.1

async function getTopList() {
  const _symbols = await redis.get(RedisKeys.TopVols(config.exchange))
  if (new Date().getMinutes() !== 0 && _symbols) return
  await redis.flushdb()
  const topVols = await getTopVolumes(config.sizeTopVol)
  const symbols = topVols.filter((t) => !config.excluded.includes(t.symbol)).map((i) => i.symbol)
  await redis.set(RedisKeys.TopVols(config.exchange), JSON.stringify(symbols))
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
      const _ac = await redis.get(RedisKeys.CandlestickAll(config.exchange, symbol, interval))
      if (!_ac) continue
      const allCandles: Candlestick[] = JSON.parse(_ac)
      if (!Array.isArray(allCandles) || allCandles.length !== config.sizeCandle) continue

      const _lc = await redis.get(RedisKeys.CandlestickLast(config.exchange, symbol, interval))
      if (!_lc) continue
      const lastCandle: Candlestick = JSON.parse(_lc)
      if ((lastCandle?.open ?? 0) === 0) continue

      const candles: Candlestick[] = [...allCandles.slice(0, -1), lastCandle]
      const [highs, lows] = getHighsLows(candles)

      const hma = talib.WMA(highs, config.maPeriod)
      const lma = talib.WMA(lows, config.maPeriod)

      const t_0 = lastCandle.openTime
      const o_0 = lastCandle.open
      const c_0 = lastCandle.close
      const hma_0 = hma.slice(-1)[0]
      const lma_0 = lma.slice(-1)[0]
      const atr = hma_0 - lma_0
      const upper = o_0 + atr * ATR_OPEN
      const lower = o_0 - atr * ATR_OPEN
      const values: TaValuesMini = {
        t_0,
        o_0,
        c_0,
        hma_0,
        lma_0,
        atr,
        upper,
        lower,
      }
      await redis.set(RedisKeys.TA(config.exchange, symbol, interval), JSON.stringify(values))
    }
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
  const id2 = setInterval(() => getTopList(), 60000) // 1m

  await fetchHistoricalPrices()
  const id3 = setInterval(() => fetchHistoricalPrices(), 60000) // 1m

  await connectWebSockets()
  const id4 = setInterval(() => connectWebSockets(), 600000) // 10m

  await calculateTaValues()
  const id5 = setInterval(() => calculateTaValues(), 2000) // 2s

  await fetchBookTickers()
  const id6 = setInterval(() => fetchBookTickers(), 4000) // 4s

  await getOpenPositions()
  const id7 = setInterval(() => getOpenPositions(), 10000) // 10s

  gracefulShutdown([id1, id2, id3, id4, id5, id6, id7])
}

main()
