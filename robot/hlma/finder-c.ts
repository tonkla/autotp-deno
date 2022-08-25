import { datetime } from '../../deps.ts'

import { OrderPositionSide, OrderSide, OrderStatus, OrderType } from '../../consts/index.ts'
import { getMarkPrice, getSymbolInfo, RedisKeys } from '../../db/redis.ts'
import { Interval } from '../../exchange/binance/enums.ts'
import { getBookDepth } from '../../exchange/binance/futures.ts'
import {
  buildLongSLMakerOrder,
  buildLongTPOrder,
  buildShortSLMakerOrder,
  buildShortTPOrder,
} from '../../exchange/binance/helper.ts'
import { millisecondsToNow } from '../../helper/datetime.ts'
import { round } from '../../helper/number.ts'
import {
  BotFunc,
  BotProps,
  Order,
  PositionRisk,
  QueryOrder,
  SymbolInfo,
} from '../../types/index.ts'
import { OhlcValues, TaValues } from '../type.ts'
import { Config, getConfig } from './config.ts'
import Trend from './trend.ts'

interface Prepare {
  tad: TaValues
  tah: TaValues
  ohlc: OhlcValues
  info: SymbolInfo
  markPrice: number
}

interface ExtBotProps extends BotProps {
  config: Config
}

const Finder = ({ config, symbols, db, redis, exchange }: ExtBotProps) => {
  const qo: QueryOrder = {
    exchange: config.exchange,
    botId: config.botId,
  }

  async function prepare(symbol: string): Promise<Prepare | null> {
    const _tad = await redis.get(RedisKeys.TA(config.exchange, symbol, Interval.D1))
    if (!_tad) return null
    const tad: TaValues = JSON.parse(_tad)
    if (tad.atr === 0) return null

    const _tah = await redis.get(RedisKeys.TA(config.exchange, symbol, config.maTimeframe))
    if (!_tah) return null
    const tah: TaValues = JSON.parse(_tah)
    if (tah.atr === 0) return null

    let ohlc: OhlcValues = { o: 0, h: 0, l: 0, c: 0, co: 0, hc: 0, cl: 0, hl: 0 }
    if (config.maTimeframe !== Interval.W1) {
      const _ohlc = await redis.get(RedisKeys.TAOHLC(config.exchange, symbol, config.maTimeframe))
      if (!_ohlc) return null
      ohlc = JSON.parse(_ohlc)
      if (ohlc.o === 0) return null
    }

    const info = await getSymbolInfo(redis, config.exchange, symbol)
    if (!info?.pricePrecision) return null

    const markPrice = await getMarkPrice(redis, config.exchange, symbol, 5)
    if (markPrice === 0) return null

    return { tad, tah, ohlc, info, markPrice }
  }

  async function createLongLimit() {
    if (await redis.get(RedisKeys.Order(config.exchange))) return

    for (const symbol of symbols) {
      const p = await prepare(symbol)
      if (!p) continue
      const { tad, tah, ohlc, info, markPrice } = p

      const tn = Trend(tad)
      if (!tn.isUpCandle()) continue
      if (markPrice > tad.cma_0) continue

      if (!(ohlc.hc < 0.3 && tah.hc_0 < 0.3 && tah.lsl_0 > 0.2)) continue
      if (markPrice > tah.cma_0 && config.maTimeframe !== Interval.D1) continue

      const siblings = await db.getSiblingOrders({
        symbol,
        botId: config.botId,
        positionSide: OrderPositionSide.Long,
      })
      if (siblings.length >= config.maxOrders) continue

      const depth = await getBookDepth(symbol)
      if (!depth?.bids[2][0]) continue

      const price = depth.bids[2][0]
      const _gap = tah.atr * config.orderGapAtr
      if (siblings.find((o) => Math.abs(o.openPrice - price) < _gap)) continue

      const qty = round((config.quoteQty / price) * config.leverage, info.qtyPrecision)
      const order: Order = {
        exchange: config.exchange,
        botId: config.botId,
        id: Date.now().toString(),
        refId: '',
        symbol,
        side: OrderSide.Buy,
        positionSide: OrderPositionSide.Long,
        type: OrderType.Limit,
        status: OrderStatus.New,
        qty,
        openPrice: price,
        closePrice: 0,
        commission: 0,
        pl: 0,
      }
      await redis.set(RedisKeys.Order(config.exchange), JSON.stringify(order))
      return
    }
  }

  async function createShortLimit() {
    if (await redis.get(RedisKeys.Order(config.exchange))) return

    for (const symbol of symbols) {
      const p = await prepare(symbol)
      if (!p) continue
      const { tad, tah, ohlc, info, markPrice } = p

      const tn = Trend(tad)
      if (!tn.isDownCandle()) continue
      if (markPrice < tad.cma_0) continue

      if (!(ohlc.cl < 0.3 && tah.cl_0 < 0.3 && tah.hsl_0 < -0.2)) continue
      if (markPrice < tah.cma_0 && config.maTimeframe !== Interval.D1) continue

      const siblings = await db.getSiblingOrders({
        symbol,
        botId: config.botId,
        positionSide: OrderPositionSide.Short,
      })
      if (siblings.length >= config.maxOrders) continue

      const depth = await getBookDepth(symbol)
      if (!depth?.asks[2][0]) continue

      const price = depth.asks[2][0]
      const _gap = tah.atr * config.orderGapAtr
      if (siblings.find((o) => Math.abs(o.openPrice - price) < _gap)) continue

      const qty = round((config.quoteQty / price) * config.leverage, info.qtyPrecision)
      const order: Order = {
        exchange: config.exchange,
        botId: config.botId,
        id: Date.now().toString(),
        refId: '',
        symbol,
        side: OrderSide.Sell,
        positionSide: OrderPositionSide.Short,
        type: OrderType.Limit,
        status: OrderStatus.New,
        qty,
        openPrice: price,
        closePrice: 0,
        commission: 0,
        pl: 0,
      }
      await redis.set(RedisKeys.Order(config.exchange), JSON.stringify(order))
      return
    }
  }

  async function createLongStop() {
    if (await redis.get(RedisKeys.Order(config.exchange))) return

    const orders = await db.getLongFilledOrders(qo)
    for (const o of orders) {
      const _pos = await redis.get(
        RedisKeys.Position(config.exchange, o.symbol, o.positionSide ?? '')
      )
      if (!_pos) continue
      const pos: PositionRisk = JSON.parse(_pos)
      if (Math.abs(pos.positionAmt) < o.qty) continue

      const p = await prepare(o.symbol)
      if (!p) continue
      const { tah, ohlc, markPrice } = p

      if (await db.getStopOrder(o.id, OrderType.FTP)) continue

      const shouldSl = ohlc.cl < 0.2 && tah.cl_0 < 0.2
      const slMin = tah.atr * config.slMinAtr
      if ((slMin > 0 && o.openPrice - markPrice > slMin) || shouldSl) {
        const order = await buildLongSLMakerOrder(o)
        if (!order) continue
        await redis.set(RedisKeys.Order(config.exchange), JSON.stringify(order))
        return
      }

      const shortOrders = await db.getShortFilledOrders({ ...qo, symbol: o.symbol })
      if (shortOrders.length > 0) {
        const so = shortOrders[0]
        if (o.openTime && so?.openTime && o.openTime < so.openTime) {
          const order = await buildLongSLMakerOrder(o)
          if (!order) continue
          await redis.set(RedisKeys.Order(config.exchange), JSON.stringify(order))
          return
        }
      }

      const tpMin = tah.atr * config.tpMinAtr
      if (tpMin > 0 && markPrice - o.openPrice > tpMin) {
        const order = await buildLongTPOrder(o)
        if (!order) continue
        await redis.set(RedisKeys.Order(config.exchange), JSON.stringify(order))
        return
      }
    }
  }

  async function createShortStop() {
    if (await redis.get(RedisKeys.Order(config.exchange))) return

    const orders = await db.getShortFilledOrders(qo)
    for (const o of orders) {
      const _pos = await redis.get(
        RedisKeys.Position(config.exchange, o.symbol, o.positionSide ?? '')
      )
      if (!_pos) continue
      const pos: PositionRisk = JSON.parse(_pos)
      if (Math.abs(pos.positionAmt) < o.qty) continue

      const p = await prepare(o.symbol)
      if (!p) continue
      const { tah, ohlc, markPrice } = p

      if (await db.getStopOrder(o.id, OrderType.FTP)) continue

      const shouldSl = ohlc.hc < 0.2 && tah.hc_0 < 0.2
      const slMin = tah.atr * config.slMinAtr
      if ((slMin > 0 && markPrice - o.openPrice > slMin) || shouldSl) {
        const order = await buildShortSLMakerOrder(o)
        if (!order) continue
        await redis.set(RedisKeys.Order(config.exchange), JSON.stringify(order))
        return
      }

      const longOrders = await db.getLongFilledOrders({ ...qo, symbol: o.symbol })
      if (longOrders.length > 0) {
        const lo = longOrders[0]
        if (o.openTime && lo?.openTime && o.openTime < lo.openTime) {
          const order = await buildShortSLMakerOrder(o)
          if (!order) continue
          await redis.set(RedisKeys.Order(config.exchange), JSON.stringify(order))
          return
        }
      }

      const tpMin = tah.atr * config.tpMinAtr
      if (tpMin > 0 && o.openPrice - markPrice > tpMin) {
        const order = await buildShortTPOrder(o)
        if (!order) continue
        await redis.set(RedisKeys.Order(config.exchange), JSON.stringify(order))
        return
      }
    }
  }

  async function cancelTimedOut() {
    if (await redis.get(RedisKeys.Order(config.exchange))) return

    const orders = await db.getNewOrders(config.botId)
    for (const o of orders) {
      const exo = await exchange.getOrder(o.symbol, o.id, o.refId)
      if (!exo || exo.status !== OrderStatus.New) continue

      if (millisecondsToNow(o.openTime) < config.timeMinutesCancel * datetime.MINUTE) continue

      const p = await prepare(o.symbol)
      if (!p) continue
      const { tah } = p

      if (Math.abs(p.markPrice - o.openPrice) < tah.atr * 0.1) continue

      await redis.set(
        RedisKeys.Order(config.exchange),
        JSON.stringify({ ...o, status: OrderStatus.Canceled })
      )
      return
    }
  }

  async function closeOrphan() {
    const orders = await db.getOpenOrders(config.botId)
    for (const o of orders) {
      if (!o.openTime || !o.positionSide) continue

      if (millisecondsToNow(o.openTime) < 4 * datetime.HOUR) continue

      const _pos = await redis.get(RedisKeys.Position(config.exchange, o.symbol, o.positionSide))
      if (!_pos) {
        await db.updateOrder({ ...o, closeTime: new Date() })
      } else {
        const pos: PositionRisk = JSON.parse(_pos)
        if (Math.abs(pos.positionAmt) >= o.qty) continue
        await db.updateOrder({ ...o, closeTime: new Date() })
      }
    }
  }

  return {
    createLongLimit,
    createShortLimit,
    createLongStop,
    createShortStop,
    cancelTimedOut,
    closeOrphan,
  }
}

const FinderC: BotFunc = async ({ symbols, db, redis, exchange }: BotProps) => {
  const cfg: Config = {
    ...(await getConfig()),
    maxOrders: 1,
  }

  const bots: Config[] = [
    { ...cfg, botId: 'C4', maTimeframe: Interval.H4 },
    { ...cfg, botId: 'C6', maTimeframe: Interval.H6 },
    { ...cfg, botId: 'C8', maTimeframe: Interval.H8 },
    { ...cfg, botId: 'CH', maTimeframe: Interval.H12 },
    { ...cfg, botId: 'CD', maTimeframe: Interval.D1 },
  ]

  function createLongLimit() {
    for (const config of bots) {
      Finder({ config, symbols, db, redis, exchange }).createLongLimit()
    }
  }

  function createShortLimit() {
    for (const config of bots) {
      Finder({ config, symbols, db, redis, exchange }).createShortLimit()
    }
  }

  function createLongStop() {
    for (const config of bots) {
      Finder({ config, symbols, db, redis, exchange }).createLongStop()
    }
  }

  function createShortStop() {
    for (const config of bots) {
      Finder({ config, symbols, db, redis, exchange }).createShortStop()
    }
  }

  function cancelTimedOut() {
    for (const config of bots) {
      Finder({ config, symbols, db, redis, exchange }).cancelTimedOut()
    }
  }

  function closeOrphan() {
    for (const config of bots) {
      Finder({ config, symbols, db, redis, exchange }).closeOrphan()
    }
  }

  return {
    createLongLimit,
    createShortLimit,
    createLongStop,
    createShortStop,
    cancelTimedOut,
    closeOrphan,
  }
}

export default FinderC
