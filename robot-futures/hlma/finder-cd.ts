import { datetime } from '../../deps.ts'

import { OrderPositionSide, OrderSide, OrderStatus, OrderType } from '../../consts/index.ts'
import { getMarkPrice, RedisKeys } from '../../db/redis.ts'
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
import { BotFunc, BotProps, Order, PositionRisk, QueryOrder } from '../../types/index.ts'
import { TaValues } from '../type.ts'
import { getSymbolInfo } from './common.ts'
import { Config, getConfig } from './config.ts'

interface Prepare {
  tad: TaValues
  tax: TaValues
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

    const _tax = await redis.get(RedisKeys.TA(config.exchange, symbol, config.maTimeframe))
    if (!_tax) return null
    const tax: TaValues = JSON.parse(_tax)
    if (tax.atr === 0) return null

    const markPrice = await getMarkPrice(redis, config.exchange, symbol, 5)
    if (markPrice === 0) return null

    return { tad, tax, markPrice }
  }

  async function getActiveSymbols() {
    const orders = await db.getOpenOrders(config.botId)
    return [...new Set(orders.map((o) => o.symbol))]
  }

  async function createLongLimit() {
    if (await redis.get(RedisKeys.Order(config.exchange))) return

    const activeSymbols = await getActiveSymbols()

    for (const symbol of symbols) {
      if (config.excluded?.includes(symbol)) continue
      if (!activeSymbols.includes(symbol) && activeSymbols.length >= config.sizeActive) {
        continue
      }

      const p = await prepare(symbol)
      if (!p) continue
      const { tad, tax, markPrice } = p

      if (tad.csl_0 < 0) continue

      if (tax.cma_0 + tax.atr * config.mosAtr < markPrice) continue
      if (tax.macd_0 < 0) continue
      if (tax.macdHist_0 < 0) continue
      if (tax.csl_0 < 0) continue
      if (tax.hc_0 > 0.3) continue

      const siblings = await db.getSiblingOrders({
        symbol,
        botId: config.botId,
        positionSide: OrderPositionSide.Long,
      })
      if (siblings.length >= config.maxOrders) continue

      const depth = await getBookDepth(symbol)
      if (!depth?.bids[1][0]) continue

      const price = depth.bids[1][0]

      const _gap = tax.atr * config.orderGapAtr
      if (siblings.find((o) => Math.abs(o.openPrice - price) < _gap)) continue

      const info = await getSymbolInfo(symbol)
      if (!info) continue

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

    const activeSymbols = await getActiveSymbols()

    for (const symbol of symbols) {
      if (config.excluded?.includes(symbol)) continue
      if (!activeSymbols.includes(symbol) && activeSymbols.length >= config.sizeActive) {
        continue
      }

      const p = await prepare(symbol)
      if (!p) continue
      const { tad, tax, markPrice } = p

      if (tad.csl_0 > 0) continue

      if (tax.cma_0 - tax.atr * config.mosAtr > markPrice) continue
      if (tax.macd_0 > 0) continue
      if (tax.macdHist_0 > 0) continue
      if (tax.csl_0 > 0) continue
      if (tax.cl_0 > 0.3) continue

      const siblings = await db.getSiblingOrders({
        symbol,
        botId: config.botId,
        positionSide: OrderPositionSide.Short,
      })
      if (siblings.length >= config.maxOrders) continue

      const depth = await getBookDepth(symbol)
      if (!depth?.asks[1][0]) continue

      const price = depth.asks[1][0]

      const _gap = tax.atr * config.orderGapAtr
      if (siblings.find((o) => Math.abs(o.openPrice - price) < _gap)) continue

      const info = await getSymbolInfo(symbol)
      if (!info) continue

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
      const { tad, tax, markPrice } = p

      if (await db.getStopOrder(o.id, OrderType.FTP)) continue

      const pl = markPrice - o.openPrice

      const shouldSl =
        minutesToNow(o.openTime) > config.timeMinutesStop &&
        tax.macdHist_0 < 0 &&
        tax.csl_0 < 0 &&
        (pl < 0 ? Math.abs(pl) > config.slMinAtr * tax.atr : pl > config.tpMinAtr * tax.atr)

      const slMax = config.slMaxAtr * tax.atr
      if (shouldSl || (slMax > 0 && o.openPrice - markPrice > slMax)) {
        const order = await buildLongSLMakerOrder(o)
        if (!order) continue
        await redis.set(RedisKeys.Order(config.exchange), JSON.stringify(order))
        return
      }

      const shouldTp =
        o.openTime &&
        o.openTime.getTime() < tad.t_0 &&
        Date.now() - datetime.MINUTE < tad.t_0 &&
        pl > config.tpMinAtr * tax.atr

      const tpMax = config.tpMaxAtr * tax.atr
      if (shouldTp || (tpMax > 0 && pl > tpMax)) {
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
      const { tad, tax, markPrice } = p

      if (await db.getStopOrder(o.id, OrderType.FTP)) continue

      const pl = o.openPrice - markPrice

      const shouldSl =
        minutesToNow(o.openTime) > config.timeMinutesStop &&
        tax.macdHist_0 > 0 &&
        tax.csl_0 > 0 &&
        (pl < 0 ? Math.abs(pl) > config.slMinAtr * tax.atr : pl > config.tpMinAtr * tax.atr)

      const slMax = config.slMaxAtr * tax.atr
      if (shouldSl || (slMax > 0 && markPrice - o.openPrice > slMax)) {
        const order = await buildShortSLMakerOrder(o)
        if (!order) continue
        await redis.set(RedisKeys.Order(config.exchange), JSON.stringify(order))
        return
      }

      const shouldTp =
        o.openTime &&
        o.openTime.getTime() < tad.t_0 &&
        Date.now() - datetime.MINUTE < tad.t_0 &&
        pl > config.tpMinAtr * tax.atr

      const tpMax = config.tpMaxAtr * tax.atr
      if (shouldTp || (tpMax > 0 && pl > tpMax)) {
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
      const { tax } = p

      if (Math.abs(p.markPrice - o.openPrice) < tax.atr * 0.2) continue

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
  const cfgA: Config = {
    ...(await getConfig()),
    mosAtr: 0,
    maxOrders: 5,
    orderGapAtr: 0.15,
    quoteQty: 3,
    slMinAtr: 0.5,
    tpMinAtr: 0.25,
    slMaxAtr: 1,
    tpMaxAtr: 2,
  }

  const bots: Config[] = [{ ...cfgA, botId: 'XD', maTimeframe: Interval.H1 }]

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
