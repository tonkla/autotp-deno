import { datetime } from '../../deps.ts'

import { OrderPositionSide, OrderSide, OrderStatus, OrderType } from '../../consts/index.ts'
import { getMarkPrice, getSymbolInfo, RedisKeys } from '../../db/redis.ts'
import { Interval } from '../../exchange/binance/enums.ts'
import { secondsToNow } from '../../helper/datetime.ts'
import { round, toNumber } from '../../helper/number.ts'
import { buildLimitOrder, buildStopOrder } from '../../helper/order.ts'
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
import Trend from './trend.ts'

interface Prepare {
  tad: TaValues
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
    const _tad = await redis.get(RedisKeys.TA(config.exchange, symbol, Interval.D1))
    if (!_tad) return null
    const tad: TaValues = JSON.parse(_tad)
    if (tad.atr === 0) return null

    const _tah = await redis.get(RedisKeys.TA(config.exchange, symbol, config.maTimeframe))
    if (!_tah) return null
    const tah: TaValues = JSON.parse(_tah)
    if (tah.atr === 0) return null

    const info = await getSymbolInfo(redis, config.exchange, symbol)
    if (!info?.pricePrecision) return null

    const markPrice = await getMarkPrice(redis, config.exchange, symbol, 5)
    if (markPrice === 0) return null

    return { tad, tah, info, markPrice }
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
      const { tad, tah, info, markPrice: mp } = p

      const tdd = Trend(tad)
      if (!tdd.isUpSlope()) continue
      if (mp > tad.hma_0 - tad.atr * 0.25) continue

      const tdh = Trend(tah)
      if (!tdh.isUpSlope()) {
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
      order.note = note(tah)
      await redis.set(RedisKeys.Order(config.exchange), JSON.stringify(order))
      return
    }
  }

  async function createShortLimit() {
    if (await redis.get(RedisKeys.Order(config.exchange))) return

    for (const symbol of symbols) {
      const p = await prepare(symbol)
      if (!p) continue
      const { tad, tah, info, markPrice: mp } = p

      const tdd = Trend(tad)
      if (!tdd.isDownSlope()) continue
      if (mp < tad.lma_0 + tad.atr * 0.25) continue

      const tdh = Trend(tah)
      if (!tdh.isDownSlope()) {
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
      order.note = note(tah)
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
      const { tad, tah, info, markPrice } = p

      if (!(await db.getStopOrder(o.id, OrderType.FSL))) {
        const slPrice = round(tad.lma_0, info.pricePrecision)
        const stopPrice = calcStopUpper(slPrice, config.slStop, info.pricePrecision)
        const diff = stopPrice > 0 ? markPrice - stopPrice : 0
        if (diff >= tah.atr * 0.1 && diff < tah.atr * 0.15) {
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
          order.note = note(tah)
          await redis.set(RedisKeys.Order(config.exchange), JSON.stringify(order))
          return
        }

        const slMin = tah.atr * config.slMinAtr
        if ((slMin > 0 && o.openPrice - markPrice > slMin) || tah.lsl_0 < 0.05) {
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
          order.note = note(tah)
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
            order.note = note(tah)
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
        if (tpPrice <= 0 || stopPrice <= 0) continue
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
        order.note = note(tah)
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
      const { tad, tah, info, markPrice } = p

      if (!(await db.getStopOrder(o.id, OrderType.FSL))) {
        const slPrice = round(tad.hma_0, info.pricePrecision)
        const stopPrice = calcStopLower(slPrice, config.slStop, info.pricePrecision)
        const diff = stopPrice - markPrice
        if (diff >= tah.atr * 0.1 && diff < tah.atr * 0.15) {
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
          order.note = note(tah)
          await redis.set(RedisKeys.Order(config.exchange), JSON.stringify(order))
          return
        }

        const slMin = tah.atr * config.slMinAtr
        if ((slMin > 0 && markPrice - o.openPrice > slMin) || tah.hsl_0 > -0.05) {
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
          order.note = note(tah)
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
            order.note = note(tah)
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
        if (tpPrice <= 0 || stopPrice <= 0) continue
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
        order.note = note(tah)
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

      if (config.timeMinutesCancel <= 0 || !o.openTime) continue
      const diff = datetime.difference(o.openTime, new Date(), { units: ['milliseconds'] })
      if ((diff?.milliseconds ?? 0) < config.timeMinutesCancel * datetime.MINUTE) continue

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

  async function cancelLong(symbol: string) {
    await cancel((await db.getLongLimitNewOrders({ ...qo, symbol }))[0])
  }

  async function cancelShort(symbol: string) {
    await cancel((await db.getShortLimitNewOrders({ ...qo, symbol }))[0])
  }

  async function cancel(order: Order | undefined) {
    if (!order || !order.openTime) return
    if (secondsToNow(order.openTime) < 300) return
    if (await redis.get(RedisKeys.Order(config.exchange))) return
    await redis.set(
      RedisKeys.Order(config.exchange),
      JSON.stringify({ ...order, status: OrderStatus.Canceled })
    )
  }

  function note(ta: TaValues): string {
    return JSON.stringify({
      tf: config.maTimeframe,
      hsl: ta.hsl_0,
      csl: ta.csl_0,
      lsl: ta.lsl_0,
    })
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

const FinderH: BotFunc = async ({ symbols, db, redis, exchange }: BotProps) => {
  const cfg: Config = {
    ...(await getConfig()),
    orderGapAtr: 0.25,
    maxOrders: 3,
    quoteQty: 3,
    slMinAtr: 1,
    tpMinAtr: 0.5,
  }

  const bots: Config[] = [
    { ...cfg, botId: '4', maTimeframe: Interval.H4 },
    { ...cfg, botId: '6', maTimeframe: Interval.H6 },
    { ...cfg, botId: '8', maTimeframe: Interval.H8 },
    { ...cfg, botId: '12', maTimeframe: Interval.H12 },
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

export default FinderH
