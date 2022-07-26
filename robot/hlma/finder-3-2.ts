import { datetime, redis as rd } from '../../deps.ts'

import { OrderPositionSide, OrderSide, OrderStatus, OrderType } from '../../consts/index.ts'
import { PostgreSQL } from '../../db/pgbf.ts'
import { getMarkPrice, getSymbolInfo, RedisKeys } from '../../db/redis.ts'
import { Interval } from '../../exchange/binance/enums.ts'
import { PrivateApi } from '../../exchange/binance/futures.ts'
import { round, toNumber } from '../../helper/number.ts'
import { calcStopLower, calcStopUpper } from '../../helper/price.ts'
import { BotClass, Order, PositionRisk, QueryOrder, SymbolInfo } from '../../types/index.ts'
import { TaValues } from '../type.ts'
import { Config, getConfig } from './config.ts'

const config: Config = {
  ...(await getConfig()),
  botId: '3',
  maTimeframe: Interval.H1,
  orderGapAtr: 0.5,
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

interface Prepare {
  tad: TaValues
  tah: TaValues
  info: SymbolInfo
  markPrice: number
}

class FinderH1 implements BotClass {
  private symbols
  private db
  private redis
  private exchange

  constructor(symbols: string[], db: PostgreSQL, redis: rd.Redis, exchange: PrivateApi) {
    this.symbols = symbols
    this.db = db
    this.redis = redis
    this.exchange = exchange
  }

  async prepare(symbol: string): Promise<Prepare | null> {
    const _tad = await this.redis.get(RedisKeys.TA(config.exchange, symbol, Interval.D1))
    if (!_tad) return null
    const tad: TaValues = JSON.parse(_tad)
    if (tad.atr === 0) return null

    const _tah = await this.redis.get(RedisKeys.TA(config.exchange, symbol, config.maTimeframe))
    if (!_tah) return null
    const tah: TaValues = JSON.parse(_tah)
    if (tah.atr === 0) return null

    const info = await getSymbolInfo(this.redis, config.exchange, symbol)
    if (!info?.pricePrecision) return null

    const markPrice = await getMarkPrice(this.redis, config.exchange, symbol, 5)
    if (markPrice === 0) return null

    return { tad, tah, info, markPrice }
  }

  private async gap(symbol: string, type: string, gap: number): Promise<number> {
    const count = await this.redis.get(
      RedisKeys.Failed(config.exchange, config.botId, symbol, type)
    )
    return count ? toNumber(count) * 10 + gap : gap
  }

  async createLongLimit() {
    if (!config.openOrder) return
    if (await this.redis.get(RedisKeys.Order(config.exchange))) return

    for (const symbol of this.symbols) {
      const p = await this.prepare(symbol)
      if (!p) continue
      const { tad, tah, info, markPrice: mp } = p

      if (
        tad.hsl_0 < 0 ||
        // (tad.hsl_0 < 0 && tad.lsl_0 < Math.abs(tad.hsl_0)) ||
        tad.lsl_0 < 0 ||
        tad.l_0 < tad.l_1 ||
        mp > tad.hma_0 - tad.atr * 0.2
      )
        continue
      // if (tah.lsl_0 < 0 || (tah.hsl_0 < 0 && tah.lsl_0 < Math.abs(tah.hsl_0))) continue
      if (tah.hsl_0 < 0 || tah.lsl_0 < 0) continue
      if (mp > tah.cma_0 - tah.atr * 0.25) continue

      const siblings = await this.db.getSiblingOrders({
        symbol,
        botId: config.botId,
        positionSide: OrderPositionSide.Long,
      })
      if (siblings.length >= config.maxOrders) continue

      const _price = mp - tah.atr * 0.25
      const _gap = tah.atr * config.orderGapAtr
      if (siblings.find((o) => Math.abs(o.openPrice - _price) < _gap)) continue

      const price = round(_price, info.pricePrecision)
      const qty = round((config.quoteQty / price) * config.leverage, info.qtyPrecision)
      const order = buildLimitOrder(symbol, OrderSide.Buy, OrderPositionSide.Long, price, qty)
      order.note = JSON.stringify({
        a: symbol,
        b: config.botId,
        p: price,
        mp: round(mp, info.pricePrecision),
        hsl: tah.hsl_0,
        csl: tah.csl_0,
        lsl: tah.lsl_0,
      })
      await this.redis.set(RedisKeys.Order(config.exchange), JSON.stringify(order))
      return
    }
  }

  async createShortLimit() {
    if (!config.openOrder) return
    if (await this.redis.get(RedisKeys.Order(config.exchange))) return

    for (const symbol of this.symbols) {
      const p = await this.prepare(symbol)
      if (!p) continue
      const { tad, tah, info, markPrice: mp } = p

      if (
        tad.hsl_0 > 0 ||
        // (tad.lsl_0 > 0 && tad.lsl_0 > Math.abs(tad.hsl_0)) ||
        tad.lsl_0 > 0 ||
        tad.h_0 > tad.h_1 ||
        mp < tad.lma_0 + tad.atr * 0.2
      )
        continue
      // if (tah.hsl_0 > 0 || (tah.lsl_0 > 0 && tah.lsl_0 > Math.abs(tah.hsl_0))) continue
      if (tah.hsl_0 > 0 || tah.lsl_0 > 0) continue
      if (mp < tah.cma_0 + tah.atr * 0.25) continue

      const siblings = await this.db.getSiblingOrders({
        symbol,
        botId: config.botId,
        positionSide: OrderPositionSide.Short,
      })
      if (siblings.length >= config.maxOrders) continue

      const _price = mp + tah.atr * 0.25
      const _gap = tah.atr * config.orderGapAtr
      if (siblings.find((o) => Math.abs(o.openPrice - _price) < _gap)) continue

      const price = round(_price, info.pricePrecision)
      const qty = round((config.quoteQty / price) * config.leverage, info.qtyPrecision)
      const order = buildLimitOrder(symbol, OrderSide.Sell, OrderPositionSide.Short, price, qty)
      order.note = JSON.stringify({
        a: symbol,
        b: config.botId,
        p: price,
        mp: round(mp, info.pricePrecision),
        hsl: tah.hsl_0,
        csl: tah.csl_0,
        lsl: tah.lsl_0,
      })
      await this.redis.set(RedisKeys.Order(config.exchange), JSON.stringify(order))
      return
    }
  }

  async createLongStop() {
    if (await this.redis.get(RedisKeys.Order(config.exchange))) return
    const orders = await this.db.getLongFilledOrders(qo)
    for (const o of orders) {
      const _pos = await this.redis.get(
        RedisKeys.Position(config.exchange, o.symbol, o.positionSide ?? '')
      )
      if (!_pos) continue
      const pos: PositionRisk = JSON.parse(_pos)
      if (Math.abs(pos.positionAmt) < o.qty) continue

      const p = await this.prepare(o.symbol)
      if (!p) continue
      const { tad, tah, info, markPrice } = p

      const openSecs = o.openTime
        ? datetime.difference(o.openTime, new Date(), { units: ['seconds'] })
        : 0

      const shouldSL = tad.lsl_0 < 0 || (tah.lsl_0 < 0 && openSecs > 1800)

      const slMin = tah.atr * config.slMinAtr
      if (
        ((slMin > 0 && o.openPrice - markPrice > slMin) || shouldSL) &&
        !(await this.db.getStopOrder(o.id, OrderType.FSL))
      ) {
        const stopPrice = calcStopLower(
          markPrice,
          await this.gap(o.symbol, OrderType.FSL, config.slStop),
          info.pricePrecision
        )
        const slPrice = calcStopLower(
          markPrice,
          await this.gap(o.symbol, OrderType.FSL, config.slLimit),
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
        await this.redis.set(RedisKeys.Order(config.exchange), JSON.stringify(order))
        return
      }

      const tpMin = tah.atr * config.tpMinAtr
      if (
        tpMin > 0 &&
        markPrice - o.openPrice > tpMin &&
        !(await this.db.getStopOrder(o.id, OrderType.FTP))
      ) {
        const stopPrice = calcStopUpper(
          markPrice,
          await this.gap(o.symbol, OrderType.FTP, config.tpStop),
          info.pricePrecision
        )
        const tpPrice = calcStopUpper(
          markPrice,
          await this.gap(o.symbol, OrderType.FTP, config.tpLimit),
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
        await this.redis.set(RedisKeys.Order(config.exchange), JSON.stringify(order))
        return
      }
    }
  }

  async createShortStop() {
    if (await this.redis.get(RedisKeys.Order(config.exchange))) return
    const orders = await this.db.getShortFilledOrders(qo)
    for (const o of orders) {
      const _pos = await this.redis.get(
        RedisKeys.Position(config.exchange, o.symbol, o.positionSide ?? '')
      )
      if (!_pos) continue
      const pos: PositionRisk = JSON.parse(_pos)
      if (Math.abs(pos.positionAmt) < o.qty) continue

      const p = await this.prepare(o.symbol)
      if (!p) continue
      const { tad, tah, info, markPrice } = p

      const openSecs = o.openTime
        ? datetime.difference(o.openTime, new Date(), { units: ['seconds'] })
        : 0

      const shouldSL = tad.hsl_0 > 0 || (tah.hsl_0 > 0 && openSecs > 1800)

      const slMin = tah.atr * config.slMinAtr
      if (
        ((slMin > 0 && markPrice - o.openPrice > slMin) || shouldSL) &&
        !(await this.db.getStopOrder(o.id, OrderType.FSL))
      ) {
        const stopPrice = calcStopUpper(
          markPrice,
          await this.gap(o.symbol, OrderType.FSL, config.slStop),
          info.pricePrecision
        )
        const slPrice = calcStopUpper(
          markPrice,
          await this.gap(o.symbol, OrderType.FSL, config.slLimit),
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
        await this.redis.set(RedisKeys.Order(config.exchange), JSON.stringify(order))
        return
      }

      const tpMin = tah.atr * config.tpMinAtr
      if (
        tpMin > 0 &&
        o.openPrice - markPrice > tpMin &&
        !(await this.db.getStopOrder(o.id, OrderType.FTP))
      ) {
        const stopPrice = calcStopLower(
          markPrice,
          await this.gap(o.symbol, OrderType.FTP, config.tpStop),
          info.pricePrecision
        )
        const tpPrice = calcStopLower(
          markPrice,
          await this.gap(o.symbol, OrderType.FTP, config.tpLimit),
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
        await this.redis.set(RedisKeys.Order(config.exchange), JSON.stringify(order))
        return
      }
    }
  }

  async cancelTimedOutOrder() {
    if (await this.redis.get(RedisKeys.Order(config.exchange))) return
    const orders = await this.db.getNewOrders(config.botId)
    for (const o of orders) {
      const exo = await this.exchange.getOrder(o.symbol, o.id, o.refId)
      if (!exo || exo.status !== OrderStatus.New) continue

      if (config.timeSecCancel <= 0 || !o.openTime) continue
      const diff = datetime.difference(o.openTime, new Date(), { units: ['seconds'] })
      if ((diff?.seconds ?? 0) < config.timeSecCancel) continue

      const p = await this.prepare(o.symbol)
      if (!p) continue
      const { tah } = p

      if (Math.abs(p.markPrice - o.openPrice) < tah.atr * config.orderGapAtr) continue

      await this.redis.set(
        RedisKeys.Order(config.exchange),
        JSON.stringify({ ...o, status: OrderStatus.Canceled })
      )
      return
    }
  }

  async closeOrphanOrder() {
    const orders = await this.db.getOpenOrders(config.botId)
    for (const o of orders) {
      if (!o.openTime || !o.positionSide) continue

      const diff = datetime.difference(o.openTime, new Date(), { units: ['minutes'] })
      if ((diff?.minutes ?? 0) < 360) continue

      const _pos = await this.redis.get(
        RedisKeys.Position(config.exchange, o.symbol, o.positionSide)
      )
      if (!_pos) {
        await this.db.updateOrder({ ...o, closeTime: new Date() })
      } else {
        const pos: PositionRisk = JSON.parse(_pos)
        if (Math.abs(pos.positionAmt) >= o.qty) continue
        await this.db.updateOrder({ ...o, closeTime: new Date() })
      }
    }
  }
}

export default FinderH1
