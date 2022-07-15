import { datetime, redis } from '../../deps.ts'

import { OrderPositionSide, OrderSide, OrderStatus, OrderType } from '../../consts/index.ts'
import { PostgreSQL } from '../../db/pgbf.ts'
import { getMarkPrice, getSymbolInfo, RedisKeys } from '../../db/redis.ts'
import { PrivateApi } from '../../exchange/binance/futures.ts'
import { round, toNumber } from '../../helper/number.ts'
import { calcStopLower, calcStopUpper } from '../../helper/price.ts'
import { Order, QueryOrder, SymbolInfo } from '../../types/index.ts'
import { getConfig } from './config.ts'
import { TaValues } from './type.ts'

const config = await getConfig()

const db = await new PostgreSQL().connect(config.dbUri)

const redisc = await redis.connect({ hostname: '127.0.0.1', port: 6379 })

const exchange = new PrivateApi(config.apiKey, config.secretKey)

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
  ta: TaValues
  info: SymbolInfo
  markPrice: number
}
async function prepare(symbol: string): Promise<Prepare | null> {
  const _ta = await redisc.get(RedisKeys.TA(config.exchange, symbol, config.maTimeframe))
  if (!_ta) return null
  const ta: TaValues = JSON.parse(_ta)
  if (ta.atr === 0) return null

  const info = await getSymbolInfo(redisc, config.exchange, symbol)
  if (!info?.pricePrecision) return null

  const markPrice = await getMarkPrice(redisc, config.exchange, symbol, 5)
  if (markPrice === 0) return null

  return { ta, info, markPrice }
}

async function gap(symbol: string, type: string, gap: number): Promise<number> {
  const count = await redisc.get(RedisKeys.Failed(config.exchange, config.botId, symbol, type))
  return count ? toNumber(count) * 10 + gap : gap
}

function getSymbols() {
  return config.included
}

async function createLongLimits() {
  if (!config.openOrder) return

  const _orders = await db.getOpenOrders(config.botId)
  const openSymbols = [...new Set(_orders.map((o) => o.symbol))]
  const symbols = getSymbols()
  for (const symbol of symbols) {
    if (await redisc.get(RedisKeys.Order(config.exchange))) return
    if (config.excluded.includes(symbol)) continue
    if (!openSymbols.includes(symbol) && openSymbols.length >= config.sizeActive) continue

    const p = await prepare(symbol)
    if (!p) continue
    const { ta, info, markPrice: mp } = p

    if (mp > ta.cma_0) continue

    let _price = 0
    if (ta.hsl_0 > 0.5 && ta.lsl_0 > 0.5) {
      _price = ta.lma_0 + ta.atr * 0.4
    } else if (ta.hsl_0 > 0.4 && ta.lsl_0 > 0.4) {
      if (mp > ta.cma_0 - ta.atr * 0.1) continue
      _price = ta.lma_0 + ta.atr * 0.3
    } else if (ta.hsl_0 > 0.3 && ta.lsl_0 > 0.3) {
      if (mp > ta.cma_0 - ta.atr * 0.2) continue
      _price = ta.lma_0 + ta.atr * 0.2
    } else if (ta.hsl_0 > 0.2 && ta.lsl_0 > 0.2) {
      if (mp > ta.cma_0 - ta.atr * 0.3) continue
      _price = ta.lma_0 + ta.atr * 0.1
    } else if (ta.hsl_0 > 0 && ta.lsl_0 > 0) {
      if (mp > ta.cma_0 - ta.atr * 0.4) continue
      _price = ta.lma_0
    } else {
      continue
    }
    if (_price > mp) {
      _price = mp - ta.atr * 0.05
    }

    const siblings = await db.getSiblingOrders({
      symbol,
      botId: config.botId,
      positionSide: OrderPositionSide.Long,
    })
    const _gap = ta.atr * config.orderGapAtr
    if (siblings.find((o) => Math.abs(o.openPrice - _price) < _gap)) continue

    const price = round(_price, info.pricePrecision)
    const qty = round((config.quoteQty / price) * config.leverage, info.qtyPrecision)
    const order = buildLimitOrder(symbol, OrderSide.Buy, OrderPositionSide.Long, price, qty)
    await redisc.set(RedisKeys.Order(config.exchange), JSON.stringify(order))
    return
  }
}

async function createShortLimits() {
  if (!config.openOrder) return

  const _orders = await db.getOpenOrders(config.botId)
  const openSymbols = [...new Set(_orders.map((o) => o.symbol))]
  const symbols = getSymbols()
  for (const symbol of symbols) {
    if (await redisc.get(RedisKeys.Order(config.exchange))) return
    if (config.excluded.includes(symbol)) continue
    if (!openSymbols.includes(symbol) && openSymbols.length >= config.sizeActive) continue

    const p = await prepare(symbol)
    if (!p) continue
    const { ta, info, markPrice: mp } = p

    if (mp < ta.cma_0) continue

    let _price = 0
    if (ta.hsl_0 < -0.5 && ta.lsl_0 < -0.5) {
      _price = ta.hma_0 - ta.atr * 0.4
    } else if (ta.hsl_0 < -0.4 && ta.lsl_0 < -0.4) {
      if (mp < ta.cma_0 + ta.atr * 0.1) continue
      _price = ta.hma_0 - ta.atr * 0.3
    } else if (ta.hsl_0 < -0.3 && ta.lsl_0 < -0.3) {
      if (mp < ta.cma_0 + ta.atr * 0.2) continue
      _price = ta.hma_0 - ta.atr * 0.2
    } else if (ta.hsl_0 < -0.2 && ta.lsl_0 < -0.2) {
      if (mp < ta.cma_0 + ta.atr * 0.3) continue
      _price = ta.hma_0 - ta.atr * 0.1
    } else if (ta.hsl_0 < 0 && ta.lsl_0 < 0) {
      if (mp < ta.cma_0 + ta.atr * 0.4) continue
      _price = ta.hma_0
    } else {
      continue
    }
    if (_price < mp) {
      _price = mp + ta.atr * 0.05
    }

    const siblings = await db.getSiblingOrders({
      symbol,
      botId: config.botId,
      positionSide: OrderPositionSide.Short,
    })
    const _gap = ta.atr * config.orderGapAtr
    if (siblings.find((o) => Math.abs(o.openPrice - _price) < _gap)) continue

    const price = round(_price, info.pricePrecision)
    const qty = round((config.quoteQty / price) * config.leverage, info.qtyPrecision)
    const order = buildLimitOrder(symbol, OrderSide.Sell, OrderPositionSide.Short, price, qty)
    await redisc.set(RedisKeys.Order(config.exchange), JSON.stringify(order))
    return
  }
}

async function createLongStops() {
  // if (Date.now()) return
  const orders = await db.getLongFilledOrders(qo)
  for (const o of orders) {
    if (await redisc.get(RedisKeys.Order(config.exchange))) return

    // const _pos = await redisc.get(
    //   RedisKeys.Position(config.exchange, o.symbol, o.positionSide ?? '')
    // )
    // if (!_pos) continue
    // const pos: PositionRisk = JSON.parse(_pos)
    // if (Math.abs(pos.positionAmt) < o.qty) continue

    const p = await prepare(o.symbol)
    if (!p) continue
    const { ta, info, markPrice } = p

    const shouldSL = ta.hsl_0 < -0.1 || ta.lsl_0 < -0.1

    const slMin = ta.atr * config.slMinAtr
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
      await redisc.set(RedisKeys.Order(config.exchange), JSON.stringify(order))
      return
    }

    const tpMin = ta.atr * config.tpMinAtr
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
      await redisc.set(RedisKeys.Order(config.exchange), JSON.stringify(order))
      return
    }
  }
}

async function createShortStops() {
  // if (Date.now()) return
  const orders = await db.getShortFilledOrders(qo)
  for (const o of orders) {
    if (await redisc.get(RedisKeys.Order(config.exchange))) return

    // const _pos = await redisc.get(
    //   RedisKeys.Position(config.exchange, o.symbol, o.positionSide ?? '')
    // )
    // if (!_pos) continue
    // const pos: PositionRisk = JSON.parse(_pos)
    // if (Math.abs(pos.positionAmt) < o.qty) continue

    const p = await prepare(o.symbol)
    if (!p) continue
    const { ta, info, markPrice } = p

    const shouldSL = ta.hsl_0 > 0.1 || ta.lsl_0 > 0.1

    const slMin = ta.atr * config.slMinAtr
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
      await redisc.set(RedisKeys.Order(config.exchange), JSON.stringify(order))
      return
    }

    const tpMin = ta.atr * config.tpMinAtr
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
      await redisc.set(RedisKeys.Order(config.exchange), JSON.stringify(order))
      return
    }
  }
}

async function cancelTimedOutOrders() {
  if (Date.now()) return
  const orders = await db.getNewOrders(config.botId)
  for (const o of orders) {
    if (await redisc.get(RedisKeys.Order(config.exchange))) return

    const exo = await exchange.getOrder(o.symbol, o.id, o.refId)
    if (!exo || exo.status !== OrderStatus.New) continue

    if (config.timeSecCancel <= 0 || !o.openTime) continue
    const diff = datetime.difference(o.openTime, new Date(), { units: ['seconds'] })
    if ((diff?.seconds ?? 0) < config.timeSecCancel) continue

    const p = await prepare(o.symbol)
    if (!p) continue
    const { ta } = p

    if (Math.abs(ta.c_0 - o.openPrice) < ta.atr * config.orderGapAtr * 2) continue

    await redisc.set(
      RedisKeys.Order(config.exchange),
      JSON.stringify({ ...o, status: OrderStatus.Canceled })
    )
    return
  }
}

function clean(intervalIds: number[]) {
  for (const id of intervalIds) {
    clearInterval(id)
  }
  db.close()
}

function gracefulShutdown(intervalIds: number[]) {
  Deno.addSignalListener('SIGINT', () => clean(intervalIds))
  Deno.addSignalListener('SIGTERM', () => clean(intervalIds))
}

function finder() {
  const id1 = setInterval(() => createLongLimits(), 5 * datetime.SECOND)

  const id2 = setInterval(() => createShortLimits(), 5 * datetime.SECOND)

  const id3 = setInterval(() => createLongStops(), 5 * datetime.SECOND)

  const id4 = setInterval(() => createShortStops(), 5 * datetime.SECOND)

  const id5 = setInterval(() => cancelTimedOutOrders(), 10 * datetime.SECOND)

  gracefulShutdown([id1, id2, id3, id4, id5])
}

finder()
