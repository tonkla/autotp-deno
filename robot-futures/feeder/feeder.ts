import { datetime, dotenv, redis as rd } from '../../deps.ts'

import { PostgreSQL } from '../../db/pgbf.ts'
import { RedisKeys } from '../../db/redis.ts'
import { wsCandlestick, wsMarkPrice } from '../../exchange/binance/futures-ws.ts'
import { getCandlesticks, getTopVolumes, PrivateApi } from '../../exchange/binance/futures.ts'
import { round } from '../../helper/number.ts'
import { calcSlopes, getHLCs } from '../../helper/price.ts'
import telegram from '../../service/telegram.ts'
import talib from '../../talib/talib.ts'
import { Candlestick, Ticker } from '../../types/index.ts'
import { TaValues } from '../type.ts'
import { getConfig } from './config.ts'

async function feeder() {
  try {
    const env = dotenv.config()

    const config = await getConfig()

    const redis = await rd.connect({ hostname: '127.0.0.1', port: 6379 })

    const db = await new PostgreSQL().connect('', {
      database: env.DB_NAME,
      hostname: env.DB_HOST,
      port: env.DB_PORT,
      user: env.DB_USER,
      password: env.DB_PASS,
      tls: { enabled: false },
    })

    const exchange = new PrivateApi(config.apiKey, config.secretKey)

    const wsList: WebSocket[] = []

    const getTopTrades = async () => {
      const _symbols = await redis.get(RedisKeys.TopVols(config.exchange))
      if (new Date().getMinutes() !== 0 && _symbols) return
      await redis.flushdb()

      const topVols = await getTopVolumes(config.sizeTopVol, config.excluded)
      const symbols = topVols.map((i) => i.symbol)
      await redis.set(RedisKeys.TopVols(config.exchange), JSON.stringify(symbols))
    }

    const getSymbols = async () => {
      const orders = await db.getAllOpenOrders()
      const _symbols: string[] = orders.map((o) => o.symbol)

      if (config.included?.length > 0) {
        _symbols.push(...config.included)
      } else {
        const _topVols = await redis.get(RedisKeys.TopVols(config.exchange))
        if (_topVols) {
          const topVols = JSON.parse(_topVols)
          if (Array.isArray(topVols)) _symbols.push(...topVols)
        }
      }

      const symbols = [...new Set(_symbols)]
      await redis.set(RedisKeys.SymbolsFutures(config.exchange), JSON.stringify(symbols))
      return symbols
    }

    const log = async () => {
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
            JSON.stringify(await getCandlesticks(symbol, interval, config.sizeCandle))
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

          const [macd, _s, hist] = talib.MACD(closes)

          const macd_0 = macd.slice(-1)[0]
          const macd_1 = macd.slice(-2)[0]
          const macd_2 = macd.slice(-3)[0]
          const macdHist_0 = hist.slice(-1)[0]
          const macdHist_1 = hist.slice(-2)[0]
          const macdHist_2 = hist.slice(-3)[0]

          const hma = talib.WMA(highs, config.maPeriod)
          const lma = talib.WMA(lows, config.maPeriod)
          const cma = talib.WMA(closes, config.maPeriod)

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

          const _hl_0 = h_0 - l_0
          const hc_0 = (h_0 - c_0) / _hl_0
          const cl_0 = (c_0 - l_0) / _hl_0
          const co_0 = (c_0 - o_0) / _hl_0
          const hl_0 = _hl_0 / atr

          const pchl =
            c_0 >= hma_0
              ? 1 + (c_0 - hma_0) / atr
              : c_0 >= lma_0
              ? 1 - (hma_0 - c_0) / atr
              : -((lma_0 - c_0) / atr)

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
            hc_0: round(hc_0, 3),
            cl_0: round(cl_0, 3),
            co_0: round(co_0, 3),
            hl_0: round(hl_0, 3),
            pchl: round(pchl, 3),
            macd_0: macd_1 < macd_0 ? 1 : macd_1 > macd_0 ? -1 : 0,
            macd_1: macd_2 < macd_1 ? 1 : macd_2 > macd_1 ? -1 : 0,
            macdHist_0: macdHist_1 < macdHist_0 ? 1 : macdHist_1 > macdHist_0 ? -1 : 0,
            macdHist_1: macdHist_2 < macdHist_1 ? 1 : macdHist_2 > macdHist_1 ? -1 : 0,
          }
          await redis.set(RedisKeys.TA(config.exchange, symbol, interval), JSON.stringify(values))
        }
      }
    }

    const getOpenPositions = async () => {
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
      db.close()
      Deno.exit()
    }

    const gracefulShutdown = (intervalIds: number[]) => {
      Deno.addSignalListener('SIGINT', () => clean(intervalIds))
      Deno.addSignalListener('SIGTERM', () => clean(intervalIds))
    }

    await log()
    const id1 = setInterval(() => log(), datetime.MINUTE)

    await getTopTrades()
    const id2 = setInterval(() => getTopTrades(), datetime.MINUTE)

    await fetchHistoricalPrices()
    const id3 = setInterval(() => fetchHistoricalPrices(), datetime.MINUTE)

    await connectWebSockets()
    const id4 = setInterval(() => connectWebSockets(), 10 * datetime.MINUTE)

    await calculateTaValues()
    const id5 = setInterval(() => calculateTaValues(), 2 * datetime.SECOND)

    const id6 = setInterval(() => getOpenPositions(), 10 * datetime.SECOND)

    gracefulShutdown([id1, id2, id3, id4, id5, id6])
  } catch (e) {
    console.error(e)
  }
}

feeder()
