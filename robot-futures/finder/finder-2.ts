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
import { minutesToNow } from '../../helper/datetime.ts'
import { round } from '../../helper/number.ts'
import { BotFunc, BotProps, Order, PositionRisk, QueryOrder } from '../../types/index.ts'
import { TaValues } from '../type.ts'
import { getSymbolInfo } from './common.ts'
import { Config, getConfig } from './config.ts'

interface Prepare {
  tad: TaValues
  tah: TaValues
  tam: TaValues
  tas: TaValues
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

    const _tah = await redis.get(RedisKeys.TA(config.exchange, symbol, Interval.H4))
    if (!_tah) return null
    const tah: TaValues = JSON.parse(_tah)
    if (tah.atr === 0) return null

    const _tam = await redis.get(RedisKeys.TA(config.exchange, symbol, Interval.H1))
    if (!_tam) return null
    const tam: TaValues = JSON.parse(_tam)
    if (tam.atr === 0) return null

    const _tas = await redis.get(RedisKeys.TA(config.exchange, symbol, Interval.M15))
    if (!_tas) return null
    const tas: TaValues = JSON.parse(_tas)
    if (tas.atr === 0) return null

    const markPrice = await getMarkPrice(redis, config.exchange, symbol, 5)
    if (markPrice === 0) return null

    return { tad, tah, tam, tas, markPrice }
  }

  async function getOpenSymbols() {
    const orders = await db.getOpenOrders(config.botId)
    return [...new Set(orders.map((o) => o.symbol))]
  }

  async function createLongLimit() {
    if (!config.openOrder) return
    if (await redis.get(RedisKeys.Order(config.exchange))) return

    const openSymbols = await getOpenSymbols()

    for (const symbol of symbols) {
      if (config.excluded?.includes(symbol)) continue
      if (!openSymbols.includes(symbol) && openSymbols.length >= config.sizeActive) {
        continue
      }

      const p = await prepare(symbol)
      if (!p) continue
      const { tad, tah, tam, tas, markPrice } = p

      if (tad.cma_0 + config.mosAtr * tad.atr < markPrice) continue
      if (tad.macd_0 < 0) continue
      if (tah.macd_0 < 0) continue
      if (tam.macd_0 < 0) continue
      if (tas.macd_0 < 0) continue

      const siblings = await db.getSiblingOrders({
        symbol,
        botId: config.botId,
        positionSide: OrderPositionSide.Long,
      })
      if (siblings.length >= config.maxOrders) continue

      const depth = await getBookDepth(symbol)
      if (!depth?.bids[1][0]) continue
      const price = depth.bids[1][0]

      const gap = tah.atr * config.orderGapAtr
      if (siblings.find((o) => Math.abs(o.openPrice - price) < gap)) continue

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
    if (!config.openOrder) return
    if (await redis.get(RedisKeys.Order(config.exchange))) return

    const openSymbols = await getOpenSymbols()

    for (const symbol of symbols) {
      if (config.excluded?.includes(symbol)) continue
      if (!openSymbols.includes(symbol) && openSymbols.length >= config.sizeActive) {
        continue
      }

      const p = await prepare(symbol)
      if (!p) continue
      const { tad, tah, tam, tas, markPrice } = p

      if (tad.cma_0 - config.mosAtr * tad.atr > markPrice) continue
      if (tad.macd_0 > 0) continue
      if (tah.macd_0 > 0) continue
      if (tam.macd_0 > 0) continue
      if (tas.macd_0 > 0) continue

      const siblings = await db.getSiblingOrders({
        symbol,
        botId: config.botId,
        positionSide: OrderPositionSide.Short,
      })
      if (siblings.length >= config.maxOrders) continue

      const depth = await getBookDepth(symbol)
      if (!depth?.asks[1][0]) continue
      const price = depth.asks[1][0]

      const gap = tah.atr * config.orderGapAtr
      if (siblings.find((o) => Math.abs(o.openPrice - price) < gap)) continue

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
      const { tah, markPrice } = p

      if (await db.getStopOrder(o.id, OrderType.FTP)) continue

      const profit = markPrice - o.openPrice
      const loss = o.openPrice - markPrice

      const slMin = config.slMinAtr * tah.atr
      const tpMin = config.tpMinAtr * tah.atr
      const slMax = config.slMaxAtr * tah.atr
      const tpMax = config.tpMaxAtr * tah.atr

      const shouldSl =
        minutesToNow(o.openTime) > config.timeMinutesStop &&
        (profit < 0 ? slMin > 0 && loss > slMin : tpMin > 0 && profit > tpMin) &&
        tah.csl_0 < 0 &&
        tah.macd_0 < 0

      if (shouldSl || (slMax > 0 && loss > slMax)) {
        const order = await buildLongSLMakerOrder(o)
        if (!order) continue
        await redis.set(RedisKeys.Order(config.exchange), JSON.stringify(order))
        return
      }

      if (tpMax > 0 && profit > tpMax) {
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

      const profit = o.openPrice - markPrice
      const loss = markPrice - o.openPrice

      const slMin = config.slMinAtr * tah.atr
      const tpMin = config.tpMinAtr * tah.atr
      const slMax = config.slMaxAtr * tah.atr
      const tpMax = config.tpMaxAtr * tah.atr

      const shouldSl =
        minutesToNow(o.openTime) > config.timeMinutesStop &&
        (profit < 0 ? slMin > 0 && loss > slMin : tpMin > 0 && profit > tpMin) &&
        tah.csl_0 > 0 &&
        tah.macd_0 > 0

      if (shouldSl || (slMax > 0 && loss > slMax)) {
        const order = await buildShortSLMakerOrder(o)
        if (!order) continue
        await redis.set(RedisKeys.Order(config.exchange), JSON.stringify(order))
        return
      }

      if (tpMax > 0 && profit > tpMax) {
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

  return {
    createLongLimit,
    createShortLimit,
    createLongStop,
    createShortStop,
    cancelTimedOut,
  }
}

const Finder2: BotFunc = async ({ symbols, db, redis, exchange }: BotProps) => {
  const cfg: Config = {
    ...(await getConfig()),
    maTimeframe: Interval.H4,
    mosAtr: 0.1,
    orderGapAtr: 0.2,
  }

  const bots: Config[] = [{ ...cfg, botId: 'B1' }]

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

  return {
    createLongLimit,
    createShortLimit,
    createLongStop,
    createShortStop,
    cancelTimedOut,
  }
}

export default Finder2
