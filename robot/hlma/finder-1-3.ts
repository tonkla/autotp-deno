import { datetime } from '../../deps.ts'

import { OrderPositionSide, OrderSide, OrderStatus, OrderType } from '../../consts/index.ts'
import { getMarkPrice, getSymbolInfo, RedisKeys } from '../../db/redis.ts'
import { Interval } from '../../exchange/binance/enums.ts'
import { round, toNumber } from '../../helper/number.ts'
import { calcStopLower, calcStopUpper } from '../../helper/price.ts'
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
  tad: TaValues
  info: SymbolInfo
  markPrice: number
}

const config: Config = {
  ...(await getConfig()),
  botId: '1',
  maTimeframe: Interval.D1,
  orderGapAtr: 0.2,
  maxOrders: 3,
  quoteQty: 3,
}

const qo: QueryOrder = {
  exchange: config.exchange,
  botId: config.botId,
}

const newOrder: Order = {
  exchange: config.exchange,
  botId: config.botId,
  id: '',
  refId: '',
  symbol: '',
  side: '',
  positionSide: '',
  type: '',
  status: '',
  qty: 0,
  openPrice: 0,
  closePrice: 0,
  commission: 0,
  pl: 0,
}

function buildLimitOrder(
  symbol: string,
  side: OrderSide,
  positionSide: OrderPositionSide,
  openPrice: number,
  qty: number
): Order {
  return {
    ...newOrder,
    id: Date.now().toString(),
    symbol,
    side,
    positionSide,
    type: OrderType.Limit,
    openPrice,
    qty,
  }
}

function buildStopOrder(
  symbol: string,
  side: OrderSide,
  positionSide: string,
  type: string,
  stopPrice: number,
  openPrice: number,
  qty: number,
  openOrderId: string
): Order {
  return {
    ...newOrder,
    id: Date.now().toString(),
    symbol,
    side,
    positionSide,
    type,
    stopPrice,
    openPrice,
    qty,
    openOrderId,
  }
}

const FinderD1: BotFunc = ({ symbols, db, redis, exchange }: BotProps) => {
  async function prepare(symbol: string): Promise<Prepare | null> {
    const _tad = await redis.get(RedisKeys.TA(config.exchange, symbol, config.maTimeframe))
    if (!_tad) return null
    const tad: TaValues = JSON.parse(_tad)
    if (tad.atr === 0) return null

    const info = await getSymbolInfo(redis, config.exchange, symbol)
    if (!info?.pricePrecision) return null

    const markPrice = await getMarkPrice(redis, config.exchange, symbol, 5)
    if (markPrice === 0) return null

    return { tad, info, markPrice }
  }

  async function gap(symbol: string, type: string, gap: number): Promise<number> {
    const count = await redis.get(RedisKeys.Failed(config.exchange, config.botId, symbol, type))
    return count ? toNumber(count) * 10 + gap : gap
  }

  async function createLongLimit() {
    if (!config.openOrder) return
    if (await redis.get(RedisKeys.Order(config.exchange))) return

    for (const symbol of symbols) {
      const p = await prepare(symbol)
      if (!p) continue
      const { tad, info, markPrice: mp } = p

      // if (tad.lsl_0 < 0 || (tad.hsl_0 < 0 && tad.lsl_0 < Math.abs(tad.hsl_0)) || tad.l_0 < tad.l_1)
      if (tad.hsl_0 < 0 || tad.lsl_0 < 0 || tad.l_0 < tad.l_1) continue
      if (mp > tad.cma_0) continue

      const siblings = await db.getSiblingOrders({
        symbol,
        botId: config.botId,
        positionSide: OrderPositionSide.Long,
      })
      if (siblings.length >= config.maxOrders) continue

      const _price = mp - tad.atr * 0.1
      const _gap = tad.atr * config.orderGapAtr
      if (siblings.find((o) => Math.abs(o.openPrice - _price) < _gap)) continue

      const price = round(_price, info.pricePrecision)
      const qty = round((config.quoteQty / price) * config.leverage, info.qtyPrecision)
      const order = buildLimitOrder(symbol, OrderSide.Buy, OrderPositionSide.Long, price, qty)
      await redis.set(RedisKeys.Order(config.exchange), JSON.stringify(order))
      return
    }
  }

  async function createShortLimit() {
    if (!config.openOrder) return
    if (await redis.get(RedisKeys.Order(config.exchange))) return

    for (const symbol of symbols) {
      const p = await prepare(symbol)
      if (!p) continue
      const { tad, info, markPrice: mp } = p

      // if (tad.hsl_0 > 0 || (tad.lsl_0 > 0 && tad.lsl_0 > Math.abs(tad.hsl_0)) || tad.h_0 > tad.h_1)
      if (tad.hsl_0 > 0 || tad.lsl_0 > 0 || tad.h_0 > tad.h_1) continue
      if (mp < tad.cma_0) continue

      const siblings = await db.getSiblingOrders({
        symbol,
        botId: config.botId,
        positionSide: OrderPositionSide.Short,
      })
      if (siblings.length >= config.maxOrders) continue

      const _price = mp + tad.atr * 0.1
      const _gap = tad.atr * config.orderGapAtr
      if (siblings.find((o) => Math.abs(o.openPrice - _price) < _gap)) continue

      const price = round(_price, info.pricePrecision)
      const qty = round((config.quoteQty / price) * config.leverage, info.qtyPrecision)
      const order = buildLimitOrder(symbol, OrderSide.Sell, OrderPositionSide.Short, price, qty)
      await redis.set(RedisKeys.Order(config.exchange), JSON.stringify(order))
      return
    }
  }

  async function createLongStop() {
    // if (Date.now()) return
    if (await redis.get(RedisKeys.Order(config.exchange))) return
    const orders = await db.getLongFilledOrders(qo)
    for (const o of orders) {
      // const _pos = await redis.get(
      //   RedisKeys.Position(config.exchange, o.symbol, o.positionSide ?? '')
      // )
      // if (!_pos) continue
      // const pos: PositionRisk = JSON.parse(_pos)
      // if (Math.abs(pos.positionAmt) < o.qty) continue

      const p = await prepare(o.symbol)
      if (!p) continue
      const { tad, info, markPrice } = p

      const shouldSL = tad.lsl_0 < 0

      const slMin = tad.atr * config.slMinAtr
      if (
        ((slMin > 0 && o.openPrice - markPrice > slMin) || shouldSL) &&
        !(await db.getStopOrder(o.id, OrderType.FSL))
      ) {
        const stopPrice = calcStopLower(
          markPrice,
          await gap(o.symbol, OrderType.FSL, config.slStop),
          info.pricePrecision
        )
        const slPrice = calcStopLower(
          markPrice,
          await gap(o.symbol, OrderType.FSL, config.slLimit),
          info.pricePrecision
        )
        if (slPrice <= 0) continue
        const order = buildStopOrder(
          o.symbol,
          OrderSide.Sell,
          OrderPositionSide.Long,
          OrderType.FSL,
          stopPrice,
          slPrice,
          o.qty,
          o.id
        )
        await redis.set(RedisKeys.Order(config.exchange), JSON.stringify(order))
        return
      }

      const tpMin = tad.atr * config.tpMinAtr
      if (
        tpMin > 0 &&
        markPrice - o.openPrice > tpMin &&
        !(await db.getStopOrder(o.id, OrderType.FTP))
      ) {
        const stopPrice = calcStopUpper(
          markPrice,
          await gap(o.symbol, OrderType.FTP, config.tpStop),
          info.pricePrecision
        )
        const tpPrice = calcStopUpper(
          markPrice,
          await gap(o.symbol, OrderType.FTP, config.tpLimit),
          info.pricePrecision
        )
        if (tpPrice <= 0) continue
        const order = buildStopOrder(
          o.symbol,
          OrderSide.Sell,
          OrderPositionSide.Long,
          OrderType.FTP,
          stopPrice,
          tpPrice,
          o.qty,
          o.id
        )
        await redis.set(RedisKeys.Order(config.exchange), JSON.stringify(order))
        return
      }
    }
  }

  async function createShortStop() {
    // if (Date.now()) return
    if (await redis.get(RedisKeys.Order(config.exchange))) return
    const orders = await db.getShortFilledOrders(qo)
    for (const o of orders) {
      // const _pos = await redis.get(
      //   RedisKeys.Position(config.exchange, o.symbol, o.positionSide ?? '')
      // )
      // if (!_pos) continue
      // const pos: PositionRisk = JSON.parse(_pos)
      // if (Math.abs(pos.positionAmt) < o.qty) continue

      const p = await prepare(o.symbol)
      if (!p) continue
      const { tad, info, markPrice } = p

      const shouldSL = tad.hsl_0 > 0

      const slMin = tad.atr * config.slMinAtr
      if (
        ((slMin > 0 && markPrice - o.openPrice > slMin) || shouldSL) &&
        !(await db.getStopOrder(o.id, OrderType.FSL))
      ) {
        const stopPrice = calcStopUpper(
          markPrice,
          await gap(o.symbol, OrderType.FSL, config.slStop),
          info.pricePrecision
        )
        const slPrice = calcStopUpper(
          markPrice,
          await gap(o.symbol, OrderType.FSL, config.slLimit),
          info.pricePrecision
        )
        if (slPrice <= 0) continue
        const order = buildStopOrder(
          o.symbol,
          OrderSide.Buy,
          OrderPositionSide.Short,
          OrderType.FSL,
          stopPrice,
          slPrice,
          o.qty,
          o.id
        )
        await redis.set(RedisKeys.Order(config.exchange), JSON.stringify(order))
        return
      }

      const tpMin = tad.atr * config.tpMinAtr
      if (
        tpMin > 0 &&
        o.openPrice - markPrice > tpMin &&
        !(await db.getStopOrder(o.id, OrderType.FTP))
      ) {
        const stopPrice = calcStopLower(
          markPrice,
          await gap(o.symbol, OrderType.FTP, config.tpStop),
          info.pricePrecision
        )
        const tpPrice = calcStopLower(
          markPrice,
          await gap(o.symbol, OrderType.FTP, config.tpLimit),
          info.pricePrecision
        )
        if (tpPrice <= 0) continue
        const order = buildStopOrder(
          o.symbol,
          OrderSide.Buy,
          OrderPositionSide.Short,
          OrderType.FTP,
          stopPrice,
          tpPrice,
          o.qty,
          o.id
        )
        await redis.set(RedisKeys.Order(config.exchange), JSON.stringify(order))
        return
      }
    }
  }

  async function cancelTimedOut() {
    // if (Date.now()) return
    if (await redis.get(RedisKeys.Order(config.exchange))) return
    const orders = await db.getNewOrders(config.botId)
    for (const o of orders) {
      const exo = await exchange.getOrder(o.symbol, o.id, o.refId)
      if (!exo || exo.status !== OrderStatus.New) continue

      if (config.timeSecCancel <= 0 || !o.openTime) continue
      const diff = datetime.difference(o.openTime, new Date(), { units: ['seconds'] })
      if ((diff?.seconds ?? 0) < config.timeSecCancel) continue

      const p = await prepare(o.symbol)
      if (!p) continue
      const { tad } = p

      if (Math.abs(p.markPrice - o.openPrice) < tad.atr * 0.1) continue

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

      const diff = datetime.difference(o.openTime, new Date(), { units: ['minutes'] })
      if ((diff?.minutes ?? 0) < 360) continue

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

export default FinderD1
