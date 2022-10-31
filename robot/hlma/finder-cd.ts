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
import { millisecondsToNow, minutesToNow } from '../../helper/datetime.ts'
import { round } from '../../helper/number.ts'
import {
  BotFunc,
  BotProps,
  Order,
  PositionRisk,
  QueryOrder,
  SymbolInfo,
} from '../../types/index.ts'
import { TaValues } from '../type.ts'
import { Config, getConfig } from './config.ts'

interface Prepare {
  tah: TaValues
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
    const _tah = await redis.get(RedisKeys.TA(config.exchange, symbol, config.maTimeframe))
    if (!_tah) return null
    const tah: TaValues = JSON.parse(_tah)
    if (tah.atr === 0) return null

    const info = await getSymbolInfo(redis, config.exchange, symbol)
    if (!info?.pricePrecision) return null

    const markPrice = await getMarkPrice(redis, config.exchange, symbol, 5)
    if (markPrice === 0) return null

    return { tah, info, markPrice }
  }

  async function createLongLimit() {
    if (await redis.get(RedisKeys.Order(config.exchange))) return

    for (const symbol of symbols) {
      const p = await prepare(symbol)
      if (!p) continue
      const { tah, info, markPrice } = p

      if (tah.cma_0 < markPrice) continue
      if (tah.cma_0 < tah.o_0) continue
      if (tah.hsl_0 < 0) continue
      if (tah.lsl_0 < 0) continue
      if (tah.l_0 < tah.l_1 && tah.l_0 < tah.l_2) continue

      const siblings = await db.getSiblingOrders({
        symbol,
        botId: config.botId,
        positionSide: OrderPositionSide.Long,
      })
      if (siblings.length >= config.maxOrders) continue

      const depth = await getBookDepth(symbol)
      if (!depth?.bids[1][0]) continue

      const price = depth.bids[1][0]

      if (price <= tah.l_0) continue

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
      const { tah, info, markPrice } = p

      if (tah.cma_0 > markPrice) continue
      if (tah.cma_0 > tah.o_0) continue
      if (tah.lsl_0 > 0) continue
      if (tah.hsl_0 > 0) continue
      if (tah.h_0 > tah.h_1 && tah.h_0 > tah.h_2) continue

      const siblings = await db.getSiblingOrders({
        symbol,
        botId: config.botId,
        positionSide: OrderPositionSide.Short,
      })
      if (siblings.length >= config.maxOrders) continue

      const depth = await getBookDepth(symbol)
      if (!depth?.asks[1][0]) continue

      const price = depth.asks[1][0]

      if (price >= tah.h_0) continue

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
      const { tah, markPrice } = p

      if (await db.getStopOrder(o.id, OrderType.FTP)) continue

      const shouldSl =
        o.openTime &&
        o.openTime.getTime() < tah.t_0 &&
        (o.openPrice < markPrice || (markPrice < tah.l_1 && markPrice < tah.l_2)) &&
        minutesToNow(o.openTime) > config.timeMinutesStop

      const slMin = tah.atr * config.slMinAtr
      if ((slMin > 0 && o.openPrice - markPrice > slMin) || shouldSl) {
        const order = await buildLongSLMakerOrder(o)
        if (!order) continue
        await redis.set(RedisKeys.Order(config.exchange), JSON.stringify(order))
        return
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
      const { tah, markPrice } = p

      if (await db.getStopOrder(o.id, OrderType.FTP)) continue

      const shouldSl =
        o.openTime &&
        o.openTime.getTime() < tah.t_0 &&
        (o.openPrice > markPrice || (markPrice > tah.h_1 && markPrice > tah.h_2)) &&
        minutesToNow(o.openTime) > config.timeMinutesStop

      const slMin = tah.atr * config.slMinAtr
      if ((slMin > 0 && markPrice - o.openPrice > slMin) || shouldSl) {
        const order = await buildShortSLMakerOrder(o)
        if (!order) continue
        await redis.set(RedisKeys.Order(config.exchange), JSON.stringify(order))
        return
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

      if (minutesToNow(o.openTime) < config.timeMinutesCancel) continue

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

const FinderCD: BotFunc = async ({ symbols, db, redis, exchange }: BotProps) => {
  const cfgC: Config = {
    ...(await getConfig()),
    orderGapAtr: 0.25,
    maxOrders: 2,
    quoteQty: 3,
    slMinAtr: 1,
    tpMinAtr: 1,
  }

  const cfgD: Config = {
    ...cfgC,
    slMinAtr: 0.5,
    tpMinAtr: 0.4,
  }

  const bots: Config[] = [
    { ...cfgC, botId: 'C2', maTimeframe: Interval.H2 },
    { ...cfgC, botId: 'C4', maTimeframe: Interval.H4 },
    { ...cfgC, botId: 'C6', maTimeframe: Interval.H6 },
    { ...cfgC, botId: 'C8', maTimeframe: Interval.H8 },
    { ...cfgC, botId: 'CD', maTimeframe: Interval.D1 },

    { ...cfgD, botId: 'D2', maTimeframe: Interval.H2 },
    { ...cfgD, botId: 'D4', maTimeframe: Interval.H4 },
    { ...cfgD, botId: 'D6', maTimeframe: Interval.H6 },
    { ...cfgD, botId: 'D8', maTimeframe: Interval.H8 },
    { ...cfgD, botId: 'DD', maTimeframe: Interval.D1 },
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

export default FinderCD