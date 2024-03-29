import { datetime, redis as rd } from '../../deps.ts'

import { RedisKeys } from '../../db/redis.ts'
import { wsCandlestick, wsMarkPrice } from '../../exchange/binance/spot-ws.ts'
import BinanceSpot from '../../exchange/binance/spot.ts'
import { round } from '../../helper/number.ts'
import { calcSlopes, getHLCs } from '../../helper/price.ts'
import telegram from '../../service/telegram.ts'
import { MACD, WMA } from '../../talib/talib.ts'
import { Candlestick, Ticker } from '../../types/index.ts'
import { TaValues } from '../type.ts'
import { getConfig } from './config.ts'

async function feeder() {
  try {
    const config = await getConfig()

    const redis = await rd.connect({ hostname: '127.0.0.1', port: 6379 })

    const exchange = BinanceSpot.new(config.apiKey, config.secretKey)

    const wsList: WebSocket[] = []

    const getSymbols = async () => {
      if (Array.isArray(config.included)) return config.included
      const { topVolumes } = await exchange.getTopTrades(20)
      return topVolumes.map((t) => t.symbol)
    }

    const _log = async () => {
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

    const fetchHistoricalPrices = async () => {
      const symbols = await getSymbols()
      for (const symbol of symbols) {
        for (const interval of config.timeframes) {
          await redis.set(
            RedisKeys.CandlestickAll(config.exchange, symbol, interval),
            JSON.stringify(await exchange.getCandlesticks(symbol, interval, config.sizeCandle))
          )
        }
      }
    }

    const connectWebSockets = async () => {
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

    const calculateTaValues = async () => {
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
          const [highs, lows, closes] = getHLCs(candles)

          const [macd, _s, hist] = MACD(closes)

          const macd_0 = macd.slice(-1)[0]
          const macd_1 = macd.slice(-2)[0]
          const macd_2 = macd.slice(-3)[0]
          const macdHist_0 = hist.slice(-1)[0]
          const macdHist_1 = hist.slice(-2)[0]
          const macdHist_2 = hist.slice(-3)[0]

          const hma = WMA(highs, config.maPeriod)
          const lma = WMA(lows, config.maPeriod)
          const cma = WMA(closes, config.maPeriod)

          const hma_0 = hma.slice(-1)[0]
          const lma_0 = lma.slice(-1)[0]
          const cma_0 = cma.slice(-1)[0]

          const atr = hma_0 - lma_0

          const mma_0 = atr / 2 + lma_0

          const hsl = calcSlopes(hma, atr, 2)
          const lsl = calcSlopes(lma, atr, 2)
          const csl = calcSlopes(cma, atr, 2)

          const hsl_0 = hsl[1]
          const lsl_0 = lsl[1]
          const csl_0 = csl[1]

          const hsl_1 = hsl[0]
          const lsl_1 = lsl[0]
          const csl_1 = csl[0]

          const t_0 = lastCandle.openTime
          const o_0 = lastCandle.open
          const h_0 = lastCandle.high
          const l_0 = lastCandle.low
          const c_0 = lastCandle.close

          const cd_1 = candles.slice(-2)[0]
          const h_1 = cd_1.high
          const l_1 = cd_1.low
          const c_1 = cd_1.close

          const cd_2 = candles.slice(-3)[0]
          const h_2 = cd_2.high
          const l_2 = cd_2.low

          const values: TaValues = {
            t_0,
            o_0,
            h_0,
            l_0,
            c_0,
            h_1,
            l_1,
            c_1,
            h_2,
            l_2,
            hma_0,
            lma_0,
            cma_0,
            mma_0,
            atr,
            hsl_0,
            lsl_0,
            csl_0,
            hsl_1,
            lsl_1,
            csl_1,
            macd_0: macd_0 > macd_1 ? 1 : -1,
            macd_1: macd_1 > macd_2 ? 1 : -1,
            macdHist: macdHist_0,
            macdHist_0: macdHist_0 > macdHist_1 ? 1 : -1,
            macdHist_1: macdHist_1 > macdHist_2 ? 1 : -1,
          }
          await redis.set(RedisKeys.TA(config.exchange, symbol, interval), JSON.stringify(values))
        }
      }
    }

    const fetchBookTickers = async () => {
      const symbols = getSymbols()
      for (const symbol of await symbols) {
        const bt = await exchange.getBookTicker(symbol)
        if (!bt) continue
        await redis.set(RedisKeys.BookTicker(config.exchange, symbol), JSON.stringify(bt))
      }
    }

    const _getOpenPositions = async () => {
      const positions = await exchange.getOpenPositions()
      await redis.set(RedisKeys.Positions(config.exchange), JSON.stringify(positions))

      const symbols = await getSymbols()
      for (const symbol of symbols) {
        for (const pos of positions) {
          if (pos.symbol !== symbol) continue
          await redis.set(
            RedisKeys.Position(config.exchange, pos.symbol, pos.positionSide),
            JSON.stringify(pos)
          )
        }
      }
    }

    const closeConnections = (): Promise<boolean> => {
      while (wsList.length > 0) {
        const ws = wsList.pop()
        if (ws) ws.close()
      }
      return Promise.resolve(true)
    }

    const clean = (intervalIds: number[]) => {
      for (const id of intervalIds) {
        clearInterval(id)
      }
      while (wsList.length > 0) {
        const ws = wsList.pop()
        if (ws) ws.close()
      }
    }

    const gracefulShutdown = (intervalIds: number[]) => {
      Deno.addSignalListener('SIGINT', () => clean(intervalIds))
      Deno.addSignalListener('SIGTERM', () => clean(intervalIds))
    }

    // await log()
    // const id1 = setInterval(() => log(), datetime.MINUTE)

    await fetchHistoricalPrices()
    const id2 = setInterval(() => fetchHistoricalPrices(), datetime.MINUTE)

    await connectWebSockets()
    const id3 = setInterval(() => connectWebSockets(), 10 * datetime.MINUTE)

    await calculateTaValues()
    const id4 = setInterval(() => calculateTaValues(), 2 * datetime.SECOND)

    await fetchBookTickers()
    const id5 = setInterval(() => fetchBookTickers(), 6 * datetime.SECOND)

    // const id6 = setInterval(() => getOpenPositions(), 10 * datetime.SECOND)

    // gracefulShutdown([id1, id2, id3, id4, id5, id6])
    gracefulShutdown([id2, id3, id4, id5])
  } catch (e) {
    console.error(e)
  }
}

feeder()
