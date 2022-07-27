import { datetime } from '../../deps.ts'

import { OrderPositionSide, OrderSide, OrderStatus, OrderType } from '../../consts/index.ts'
import { getMarkPrice, getSymbolInfo, RedisKeys } from '../../db/redis.ts'
import { Interval } from '../../exchange/binance/enums.ts'
import { round, toNumber } from '../../helper/number.ts'
import { buildLimitOrder, buildStopOrder } from '../../helper/order.ts'
import { calcStopLower, calcStopUpper } from '../../helper/price.ts'
import { BotFunc, BotProps, PositionRisk, QueryOrder, SymbolInfo } from '../../types/index.ts'
import { TaValues } from '../type.ts'
import { Config, getConfig } from './config.ts'

interface Prepare {
  tah: TaValues
  info: SymbolInfo
  markPrice: number
}

const config: Config = {
  ...(await getConfig()),
  botId: '4',
  maTimeframe: Interval.H4,
  orderGapAtr: 0.25,
  maxOrders: 3,
  quoteQty: 3,
  slMinAtr: 0,
  tpMinAtr: 0.8,
}

const qo: QueryOrder = {
  exchange: config.exchange,
  botId: config.botId,
}

const FinderH4_2: BotFunc = ({ symbols, db, redis, exchange }: BotProps) => {
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

  async function gap(symbol: string, type: string, gap: number): Promise<number> {
    const count = await redis.get(RedisKeys.Failed(config.exchange, config.botId, symbol, type))
    return count ? toNumber(count) * 10 + gap : gap
  }

  async function createLongLimit() {
    if (await redis.get(RedisKeys.Order(config.exchange))) return

    for (const symbol of symbols) {
      const p = await prepare(symbol)
      if (!p) continue
      const { tah, info, markPrice: mp } = p

      if (tah.hsl_0 < 0 || tah.lsl_0 < 0) {
        await cancelLong(symbol)
        continue
      }
      if (tah.l_0 < tah.l_1 && tah.l_0 < tah.l_2) {
        await cancelLong(symbol)
        continue
      }
      if (mp > tah.cma_0) continue

      const siblings = await db.getSiblingOrders({
        symbol,
        botId: config.botId,
        positionSide: OrderPositionSide.Long,
      })
      if (siblings.length >= config.maxOrders) continue

      const _price = mp - tah.atr * 0.1
      const _gap = tah.atr * config.orderGapAtr
      if (siblings.find((o) => Math.abs(o.openPrice - _price) < _gap)) continue

      const price = round(_price, info.pricePrecision)
      const qty = round((config.quoteQty / price) * config.leverage, info.qtyPrecision)
      const order = buildLimitOrder(
        config.exchange,
        config.botId,
        symbol,
        OrderSide.Buy,
        OrderPositionSide.Long,
        price,
        qty
      )
      await redis.set(RedisKeys.Order(config.exchange), JSON.stringify(order))
      return
    }
  }

  async function createShortLimit() {
    if (await redis.get(RedisKeys.Order(config.exchange))) return

    for (const symbol of symbols) {
      const p = await prepare(symbol)
      if (!p) continue
      const { tah, info, markPrice: mp } = p

      if (tah.hsl_0 > 0 || tah.lsl_0 > 0) {
        await cancelShort(symbol)
        continue
      }
      if (tah.h_0 > tah.h_1 && tah.h_0 > tah.h_2) {
        await cancelShort(symbol)
        continue
      }
      if (mp < tah.cma_0) continue

      const siblings = await db.getSiblingOrders({
        symbol,
        botId: config.botId,
        positionSide: OrderPositionSide.Short,
      })
      if (siblings.length >= config.maxOrders) continue

      const _price = mp + tah.atr * 0.1
      const _gap = tah.atr * config.orderGapAtr
      if (siblings.find((o) => Math.abs(o.openPrice - _price) < _gap)) continue

      const price = round(_price, info.pricePrecision)
      const qty = round((config.quoteQty / price) * config.leverage, info.qtyPrecision)
      const order = buildLimitOrder(
        config.exchange,
        config.botId,
        symbol,
        OrderSide.Sell,
        OrderPositionSide.Short,
        price,
        qty
      )
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
      const { tah, info, markPrice } = p

      if (!(await db.getStopOrder(o.id, OrderType.FSL))) {
        const slPrice = (tah.l_1 < tah.l_2 ? tah.l_1 : tah.l_2) - tah.atr * 0.05
        const stopPrice = calcStopUpper(slPrice, config.slStop, info.pricePrecision)
        if (stopPrice > 0 && markPrice - stopPrice < tah.atr * 0.2) {
          const order = buildStopOrder(
            config.exchange,
            config.botId,
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

        const slMin = tah.atr * config.slMinAtr
        if (slMin > 0 && o.openPrice - markPrice > slMin) {
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
            config.exchange,
            config.botId,
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

        const shortOrders = await db.getShortFilledOrders({ ...qo, symbol: o.symbol })
        if (shortOrders.length > 0) {
          const so = shortOrders[0]
          if (o.openTime && so?.openTime && o.openTime < so.openTime) {
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
              config.exchange,
              config.botId,
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
        }
      }

      const tpMin = tah.atr * config.tpMinAtr
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
          config.exchange,
          config.botId,
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
      const { tah, info, markPrice } = p

      if (!(await db.getStopOrder(o.id, OrderType.FSL))) {
        const slPrice = (tah.h_1 > tah.h_2 ? tah.h_1 : tah.h_2) + tah.atr * 0.05
        const stopPrice = calcStopLower(slPrice, config.slStop, info.pricePrecision)
        if (stopPrice > 0 && stopPrice - markPrice < tah.atr * 0.2) {
          const order = buildStopOrder(
            config.exchange,
            config.botId,
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

        const slMin = tah.atr * config.slMinAtr
        if (slMin > 0 && markPrice - o.openPrice > slMin) {
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
            config.exchange,
            config.botId,
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

        const longOrders = await db.getLongFilledOrders({ ...qo, symbol: o.symbol })
        if (longOrders.length > 0) {
          const lo = longOrders[0]
          if (o.openTime && lo?.openTime && o.openTime < lo.openTime) {
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
              config.exchange,
              config.botId,
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
        }
      }

      const tpMin = tah.atr * config.tpMinAtr
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
          config.exchange,
          config.botId,
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
      const { tah } = p

      if (Math.abs(p.markPrice - o.openPrice) < tah.atr * config.orderGapAtr) continue

      await redis.set(
        RedisKeys.Order(config.exchange),
        JSON.stringify({ ...o, status: OrderStatus.Canceled })
      )
      return
    }
  }

  async function cancelLong(symbol: string) {
    const order = ((await db.getLongLimitNewOrders({ ...qo, symbol })) ?? [])[0]
    if (!order) return
    await redis.set(
      RedisKeys.Order(config.exchange),
      JSON.stringify({ ...order, status: OrderStatus.Canceled })
    )
  }

  async function cancelShort(symbol: string) {
    const order = ((await db.getShortLimitNewOrders({ ...qo, symbol })) ?? [])[0]
    if (!order) return
    await redis.set(
      RedisKeys.Order(config.exchange),
      JSON.stringify({ ...order, status: OrderStatus.Canceled })
    )
  }

  async function closeOrphan() {
    const orders = await db.getOpenOrders(config.botId)
    for (const o of orders) {
      if (!o.openTime || !o.positionSide) continue

      const diff = datetime.difference(o.openTime, new Date(), { units: ['minutes'] })
      if ((diff?.minutes ?? 0) < 240) continue

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

export default FinderH4_2
