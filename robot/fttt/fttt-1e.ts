import { connect } from 'https://deno.land/x/redis@v0.25.5/mod.ts'

import { OrderPositionSide } from '../../consts/index.ts'
import { PostgreSQL } from '../../db/pgbf.ts'
import { RedisKeys } from '../../db/redis.ts'
import { Interval } from '../../exchange/binance/enums.ts'
import {
  getBookTicker,
  getCandlesticks,
  getTopVolumes,
  PrivateApi,
} from '../../exchange/binance/futures.ts'
import { wsCandlestick, wsMarkPrice } from '../../exchange/binance/futures-ws.ts'
import { round } from '../../helper/number.ts'
import { getHighsLowsCloses, getOHLC } from '../../helper/price.ts'
import telegram from '../../service/telegram.ts'
import talib from '../../talib/talib.ts'
import { Candlestick, OHLC, TaValues_v3, TaMA, TaPC, Ticker } from '../../types/index.ts'
import { getConfig } from './config.ts'

const config = await getConfig()

const db = await new PostgreSQL().connect(config.dbUri)

const redis = await connect({ hostname: '127.0.0.1', port: 6379 })

const exchange = new PrivateApi(config.apiKey, config.secretKey)

const wsList: WebSocket[] = []

const MaxPrice = 300
const SizeD1M5 = 288
const SizeH1M5 = 12
const Fetched = { list: false, d: false, h: false, ws: true }

async function findTrendySymbols() {
  const symbols: string[] = []
  if (new Date().getMinutes() === 0 || !Fetched.list) {
    await redis.flushdb()
    symbols.push(...(await getTopVolumes(200)).map((i) => i.symbol))
    await redis.set(
      RedisKeys.SymbolsFutures(config.exchange),
      JSON.stringify({ symbols, count: symbols.length })
    )
  }

  if (new Date().getMinutes() % 10 !== 0 && Fetched.list) return
  else if (symbols.length === 0) {
    const _symbols = await redis.get(RedisKeys.SymbolsFutures(config.exchange))
    if (_symbols) symbols.push(...JSON.parse(_symbols).symbols)
  }

  const ups: string[] = []
  const downs: string[] = []
  const longs: string[] = []
  const shorts: string[] = []
  for (const symbol of symbols) {
    const candles: Candlestick[] = await getCandlesticks(symbol, Interval.D1, config.sizeCandle)
    if (candles.length !== config.sizeCandle) continue

    const [highs, lows] = getHighsLowsCloses(candles)
    const hma = talib.WMA(highs, config.maPeriod)
    const lma = talib.WMA(lows, config.maPeriod)

    const hma_0 = hma.slice(-1)[0]
    const hma_1 = hma.slice(-2)[0]
    const lma_0 = lma.slice(-1)[0]
    const lma_1 = lma.slice(-2)[0]
    const atr = hma_0 - lma_0

    const close = candles.slice(-1)[0].close

    if (close > MaxPrice) continue
    if (hma_1 < hma_0 && lma_1 < lma_0) ups.push(symbol)
    if (hma_1 > hma_0 && lma_1 > lma_0) downs.push(symbol)

    const isUptrend = hma_1 < hma_0 && lma_1 < lma_0 && close < hma_0 - atr * 0.3
    const isDowntrend = hma_1 > hma_0 && lma_1 > lma_0 && close > lma_0 + atr * 0.3

    if (isUptrend) longs.push(symbol)
    if (isDowntrend) shorts.push(symbol)
    if (isUptrend || isDowntrend) {
      await redis.set(
        RedisKeys.CandlestickAll(config.exchange, symbol, Interval.D1),
        JSON.stringify(candles)
      )
    }
  }
  await redis.set(RedisKeys.TopLongs(config.exchange), JSON.stringify(longs))
  await redis.set(RedisKeys.TopShorts(config.exchange), JSON.stringify(shorts))
  Fetched.list = true
  Fetched.ws = false

  console.info({
    up: { count: ups.length, symbols: ups.slice(0, 10), long: longs.slice(0, 10) },
    down: { count: downs.length, symbols: downs.slice(0, 10), short: shorts.slice(0, 10) },
  })
}

async function getSymbols(): Promise<{ longs: string[]; shorts: string[]; symbols: string[] }> {
  const orders = await db.getAllOpenOrders()
  const longs: string[] = orders
    .filter((o) => o.positionSide === OrderPositionSide.Long)
    .map((o) => o.symbol)
  const shorts: string[] = orders
    .filter((o) => o.positionSide === OrderPositionSide.Short)
    .map((o) => o.symbol)

  const _topLongs = await redis.get(RedisKeys.TopLongs(config.exchange))
  if (_topLongs) {
    const topLongs = JSON.parse(_topLongs)
    if (Array.isArray(topLongs)) {
      longs.push(...topLongs.filter((s) => !config.excluded?.includes(s)))
    }
  }

  const _topShorts = await redis.get(RedisKeys.TopShorts(config.exchange))
  if (_topShorts) {
    const topShorts = JSON.parse(_topShorts)
    if (Array.isArray(topShorts)) {
      shorts.push(...topShorts.filter((s) => !config.excluded?.includes(s)))
    }
  }

  const _longs = [...new Set(longs)].slice(0, config.sizeActive)
  const _shorts = [...new Set(shorts)].slice(0, config.sizeActive)
  return {
    longs: _longs,
    shorts: _shorts,
    symbols: [..._shorts, ..._longs],
  }
}

async function fetchDayHistoricalPrices(symbols: string[]) {
  if (new Date().getMinutes() % 10 !== 0 && Fetched.d) return
  for (const symbol of symbols) {
    if (await redis.get(RedisKeys.CandlestickAll(config.exchange, symbol, Interval.D1))) continue
    await redis.set(
      RedisKeys.CandlestickAll(config.exchange, symbol, Interval.D1),
      JSON.stringify(await getCandlesticks(symbol, Interval.D1, config.sizeCandle))
    )
  }
  Fetched.d = true
}

async function _fetchHourHistoricalPrices(symbols: string[]) {
  if (new Date().getMinutes() % 10 !== 0 && Fetched.h) return
  for (const symbol of symbols) {
    await redis.set(
      RedisKeys.CandlestickAll(config.exchange, symbol, Interval.H1),
      JSON.stringify(await getCandlesticks(symbol, Interval.H1, config.sizeCandle))
    )
  }
  Fetched.h = true
}

async function fetchMinuteHistoricalPrices(symbols: string[]) {
  for (const symbol of symbols) {
    await redis.set(
      RedisKeys.CandlestickAll(config.exchange, symbol, Interval.M5),
      JSON.stringify(await getCandlesticks(symbol, Interval.M5, SizeD1M5))
    )
  }
}

async function fetchHistoricalPrices() {
  const { symbols } = await getSymbols()
  fetchDayHistoricalPrices(symbols)
  // fetchHourHistoricalPrices(symbols)
  fetchMinuteHistoricalPrices(symbols)
}

async function connectWebSockets() {
  if (Fetched.ws) return
  await closeConnections()
  const { symbols } = await getSymbols()
  for (const symbol of symbols) {
    wsList.push(
      wsMarkPrice(
        symbol,
        async (t: Ticker) =>
          await redis.set(RedisKeys.MarkPrice(config.exchange, symbol), JSON.stringify(t))
      )
    )
    for (const interval of [Interval.D1, Interval.M5]) {
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
  Fetched.ws = true
}

async function calculateMA(symbol: string, interval: string): Promise<TaMA | null> {
  const _ac = await redis.get(RedisKeys.CandlestickAll(config.exchange, symbol, interval))
  if (!_ac) return null
  const allCandles: Candlestick[] = JSON.parse(_ac)
  if (!Array.isArray(allCandles) || allCandles.length !== config.sizeCandle) return null

  const _lc = await redis.get(RedisKeys.CandlestickLast(config.exchange, symbol, interval))
  if (!_lc) return null
  const lastCandle: Candlestick = JSON.parse(_lc)
  if ((lastCandle?.open ?? 0) === 0) return null

  const candles: Candlestick[] = [...allCandles.slice(0, -1), lastCandle]
  const [highs, lows, closes] = getHighsLowsCloses(candles)

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

  return {
    hma_0,
    hma_1,
    lma_0,
    lma_1,
    cma_0,
    cma_1,
    atr,
    slope,
  }
}

async function calculatePC(symbol: string, size: number, atr: number): Promise<TaPC | null> {
  if (atr === 0) return null

  const _allCandles = await redis.get(
    RedisKeys.CandlestickAll(config.exchange, symbol, Interval.M5)
  )
  if (!_allCandles) return null
  const allCandles: Candlestick[] = JSON.parse(_allCandles)

  const _lastCandle = await redis.get(
    RedisKeys.CandlestickLast(config.exchange, symbol, Interval.M5)
  )
  if (!_lastCandle) return null
  const lastCandle: Candlestick = JSON.parse(_lastCandle)
  if ((lastCandle?.open ?? 0) === 0) return null

  const _candles: Candlestick[] = [...allCandles.slice(0, -1), lastCandle]
  const candles: OHLC[] = _candles.map(
    (c) => ({ o: c.open, h: c.high, l: c.low, c: c.close } as OHLC)
  )

  const ohlc: OHLC | null = getOHLC(candles.slice(candles.length - size))
  if (!ohlc) return null

  const { o, h, l, c } = ohlc
  const _hl = h - l
  const hl = (_hl / atr) * 100
  const hc = ((h - c) / _hl) * 100
  const cl = ((c - l) / _hl) * 100
  const co = ((c - o) / _hl) * 100

  return {
    o,
    h,
    l,
    c,
    hl,
    hc,
    cl,
    co,
  }
}

async function calculateTaValues() {
  const tav = {
    o: 0,
    h: 0,
    l: 0,
    c: 0,
    hl: 0,
    hc: 0,
    cl: 0,
    co: 0,
    hma_0: 0,
    hma_1: 0,
    lma_0: 0,
    lma_1: 0,
    cma_0: 0,
    cma_1: 0,
    atr: 0,
    slope: 0,
  }
  const { symbols } = await getSymbols()
  for (const symbol of symbols) {
    const ta: TaValues_v3 = { d: { ...tav }, h: { ...tav } }
    for (const interval of [Interval.D1]) {
      const ma = await calculateMA(symbol, interval)
      if (!ma) continue
      if (interval === Interval.D1) {
        ta.d = { ...tav, ...ta.d, ...ma }
      } else if (interval === Interval.H1) {
        ta.h = { ...tav, ...ta.h, ...ma }
      }
    }
    for (const interval of [Interval.D1]) {
      const size = interval === Interval.D1 ? SizeD1M5 : Interval.H1 ? SizeH1M5 : 0
      const pc = await calculatePC(symbol, size, ta.d.atr)
      if (!pc) continue
      if (interval === Interval.D1) {
        ta.d = { ...tav, ...ta.d, ...pc }
      } else if (interval === Interval.H1) {
        ta.h = { ...tav, ...ta.h, ...pc }
      }
    }
    await redis.set(RedisKeys.TA(config.exchange, symbol), JSON.stringify(ta))
  }
}

async function fetchBookTickers() {
  const { symbols } = await getSymbols()
  for (const symbol of symbols) {
    const bt = await getBookTicker(symbol)
    if (!bt) continue
    await redis.set(RedisKeys.BookTicker(config.exchange, symbol), JSON.stringify(bt))
  }
}

async function getOpenPositions() {
  const positions = await exchange.getOpenPositions()
  for (const pos of positions) {
    await redis.set(
      RedisKeys.Position(config.exchange, pos.symbol, pos.positionSide),
      JSON.stringify(pos)
    )
  }
  await redis.set(RedisKeys.Positions(config.exchange), JSON.stringify(positions))
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
  const id1 = setInterval(() => log(), 60000)

  await findTrendySymbols()
  const id2 = setInterval(() => findTrendySymbols(), 60000)

  await fetchHistoricalPrices()
  const id3 = setInterval(() => fetchHistoricalPrices(), 60000)

  await connectWebSockets()
  const id4 = setInterval(() => connectWebSockets(), 20000)

  await calculateTaValues()
  const id5 = setInterval(() => calculateTaValues(), 3000)

  await fetchBookTickers()
  const id6 = setInterval(() => fetchBookTickers(), 6000)

  await getOpenPositions()
  const id7 = setInterval(() => getOpenPositions(), 10000)

  gracefulShutdown([id1, id2, id3, id4, id5, id6, id7])
}

main()
