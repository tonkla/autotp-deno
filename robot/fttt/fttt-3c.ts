import { difference } from 'https://deno.land/std@0.135.0/datetime/mod.ts'
import { connect } from 'https://deno.land/x/redis@v0.25.4/mod.ts'

import { OrderSide, OrderPositionSide, OrderStatus, OrderType } from '../../consts/index.ts'
import { PostgreSQL } from '../../db/pgbf.ts'
import { RedisKeys, getMarkPrice, getSymbolInfo } from '../../db/redis.ts'
import { PrivateApi } from '../../exchange/binance/futures.ts'
import { round, toNumber } from '../../helper/number.ts'
import { calcStopLower, calcStopUpper } from '../../helper/price.ts'
import { Order, PositionRisk, QueryOrder, SymbolInfo, TaValuesX } from '../../types/index.ts'
import { getConfig } from './config.ts'

const config = await getConfig()

const db = await new PostgreSQL().connect(config.dbUri)

const redis = await connect({ hostname: '127.0.0.1', port: 6379 })

const exchange = new PrivateApi(config.apiKey, config.secretKey)

const ATR_CANCEL = 0.2

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

function buildMarketOrder(
  symbol: string,
  side: OrderSide,
  positionSide: OrderPositionSide,
  qty: number,
  openOrderId: string
): Order {
  return {
    ...newOrder,
    id: Date.now().toString(),
    symbol,
    side,
    positionSide,
    type: OrderType.Market,
    qty,
    openOrderId,
  }
}

interface Prepare {
  ta: TaValuesX
  info: SymbolInfo
  markPrice: number
}
async function prepare(symbol: string): Promise<Prepare | null> {
  const _ta = await redis.get(RedisKeys.TA(config.exchange, symbol, config.maTimeframe))
  if (!_ta) return null
  const ta: TaValuesX = JSON.parse(_ta)
  if (ta.atr === 0) return null

  const info = await getSymbolInfo(redis, config.exchange, symbol)
  if (!info?.pricePrecision) return null

  const markPrice = await getMarkPrice(redis, config.exchange, symbol, 5)
  if (markPrice === 0) return null

  return { ta, info, markPrice }
}

async function gap(symbol: string, type: string, gap: number): Promise<number> {
  const count = await redis.get(RedisKeys.Failed(config.exchange, config.botId, symbol, type))
  return count ? toNumber(count) * 10 + gap : gap
}

async function getSymbols(): Promise<string[]> {
  const orders = await db.getOpenOrders(config.botId)
  const symbols: string[] = orders.map((o) => o.symbol)

  const _topVols = await redis.get(RedisKeys.TopVols(config.exchange))
  if (_topVols) {
    const topVols = JSON.parse(_topVols)
    if (Array.isArray(topVols)) symbols.push(...topVols)
  }

  return [...new Set(symbols)]
}

async function createLongLimits() {
  const _orders = await db.getOpenOrders(config.botId)
  const openSymbols = [...new Set(_orders.map((o) => o.symbol))]
  const symbols = await getSymbols()
  for (const symbol of symbols) {
    if (await redis.get(RedisKeys.Order(config.exchange))) return
    if (!openSymbols.includes(symbol) && openSymbols.length >= config.sizeActive) continue

    const p = await prepare(symbol)
    if (!p) continue
    const { ta, info, markPrice } = p

    if (!config.openOrder || ta.cma_1 > ta.cma_0 || ta.o_0 > ta.cma_0) continue

    const siblings = await db.getSiblingOrders({
      symbol,
      botId: config.botId,
      positionSide: OrderPositionSide.Long,
    })
    if (siblings.length >= config.maxOrders) continue

    let price = round(ta.o_0 - ta.atr * config.orderGapAtr, info.pricePrecision)
    if (siblings.length > 0) {
      if (markPrice < siblings[0].openPrice) continue
      price = round(siblings[0].openPrice + ta.atr * config.orderGapAtr, info.pricePrecision)
      if (siblings.find((o) => Math.abs(o.openPrice - price) < ta.atr * config.orderGapAtr))
        continue
    }

    if (Math.abs(markPrice - price) > ta.atr * ATR_CANCEL) continue

    const qty = round((config.quoteQty / price) * config.leverage, info.qtyPrecision)
    const order = buildLimitOrder(symbol, OrderSide.Buy, OrderPositionSide.Long, price, qty)
    await redis.set(RedisKeys.Order(config.exchange), JSON.stringify(order))
    return
  }
}

async function createShortLimits() {
  const _orders = await db.getOpenOrders(config.botId)
  const openSymbols = [...new Set(_orders.map((o) => o.symbol))]
  const symbols = await getSymbols()
  for (const symbol of symbols) {
    if (await redis.get(RedisKeys.Order(config.exchange))) return
    if (!openSymbols.includes(symbol) && openSymbols.length >= config.sizeActive) continue

    const p = await prepare(symbol)
    if (!p) continue
    const { ta, info, markPrice: mp } = p

    if (!config.openOrder || ta.cma_1 < ta.cma_0 || ta.o_0 < ta.cma_0) continue

    const siblings = await db.getSiblingOrders({
      symbol,
      botId: config.botId,
      positionSide: OrderPositionSide.Short,
    })
    if (siblings.length >= config.maxOrders) continue

    let price = round(ta.o_0 + ta.atr * config.orderGapAtr, info.pricePrecision)
    if (siblings.length > 0) {
      if (mp > siblings[0].openPrice) continue
      price = round(siblings[0].openPrice - ta.atr * config.orderGapAtr, info.pricePrecision)
      if (siblings.find((o) => Math.abs(o.openPrice - price) < ta.atr * config.orderGapAtr))
        continue
    }

    if (Math.abs(mp - price) > ta.atr * ATR_CANCEL) continue

    const qty = round((config.quoteQty / price) * config.leverage, info.qtyPrecision)
    const order = buildLimitOrder(symbol, OrderSide.Sell, OrderPositionSide.Short, price, qty)
    await redis.set(RedisKeys.Order(config.exchange), JSON.stringify(order))
    return
  }
}

async function createLongStops() {
  const orders = await db.getLongFilledOrders(qo)
  for (const o of orders) {
    if (await redis.get(RedisKeys.Order(config.exchange))) return

    const _pos = await redis.get(
      RedisKeys.Position(config.exchange, o.symbol, o.positionSide ?? '')
    )
    if (!_pos) continue
    const pos: PositionRisk = JSON.parse(_pos)
    if (Math.abs(pos.positionAmt) < o.qty) continue

    const p = await prepare(o.symbol)
    if (!p) continue
    const { ta, info, markPrice } = p

    const slMin = ta.atr * config.slMinAtr
    if (
      slMin > 0 &&
      o.openPrice - markPrice > slMin &&
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
      await redis.set(RedisKeys.Order(config.exchange), JSON.stringify(order))
      return
    }
  }
}

async function createShortStops() {
  const orders = await db.getShortFilledOrders(qo)
  for (const o of orders) {
    if (await redis.get(RedisKeys.Order(config.exchange))) return

    const _pos = await redis.get(
      RedisKeys.Position(config.exchange, o.symbol, o.positionSide ?? '')
    )
    if (!_pos) continue
    const pos: PositionRisk = JSON.parse(_pos)
    if (Math.abs(pos.positionAmt) < o.qty) continue

    const p = await prepare(o.symbol)
    if (!p) continue
    const { ta, info, markPrice } = p

    const slMin = ta.atr * config.slMinAtr
    if (
      slMin > 0 &&
      markPrice - o.openPrice > slMin &&
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
      await redis.set(RedisKeys.Order(config.exchange), JSON.stringify(order))
      return
    }
  }
}

async function monitorPnL() {
  let lpl = 0
  const longs = await db.getLongFilledOrders(qo)
  for (const o of longs) {
    const p = await prepare(o.symbol)
    if (!p) continue
    lpl += (p.markPrice - o.openPrice) * o.qty - o.commission * 2
  }
  await redis.set(RedisKeys.PnL(config.exchange, config.botId, OrderPositionSide.Long), lpl)

  let spl = 0
  const shorts = await db.getShortFilledOrders(qo)
  for (const o of shorts) {
    const p = await prepare(o.symbol)
    if (!p) continue
    spl += (o.openPrice - p.markPrice) * o.qty - o.commission * 2
  }
  await redis.set(RedisKeys.PnL(config.exchange, config.botId, OrderPositionSide.Short), spl)
}

async function cancelTimedOutOrders() {
  const orders = await db.getNewOrders(config.botId)
  for (const o of orders) {
    if (await redis.get(RedisKeys.Order(config.exchange))) return

    const exo = await exchange.getOrder(o.symbol, o.id, o.refId)
    if (!exo || exo.status !== OrderStatus.New) continue

    if (config.timeSecCancel <= 0 || !o.openTime) continue
    const diff = difference(o.openTime, new Date(), { units: ['seconds'] })
    if ((diff?.seconds ?? 0) < config.timeSecCancel) continue

    const p = await prepare(o.symbol)
    if (!p) continue
    const { ta } = p

    if (Math.abs(ta.c_0 - o.openPrice) < ta.atr * ATR_CANCEL) continue

    await redis.set(
      RedisKeys.Order(config.exchange),
      JSON.stringify({ ...o, status: OrderStatus.Canceled })
    )
    return
  }
}

async function clearOutdatedOrders() {
  const orders = await db.getOpenOrders(config.botId)
  for (const o of orders) {
    if (await redis.get(RedisKeys.Order(config.exchange))) return

    const p = await prepare(o.symbol)
    if (!p) continue
    const { ta, info, markPrice } = p

    if (!o.openTime || new Date(ta.t_0) < o.openTime) continue

    if (o.status === OrderStatus.New) {
      await redis.set(
        RedisKeys.Order(config.exchange),
        JSON.stringify({ ...o, status: OrderStatus.Canceled })
      )
      return
    } else if (o.status === OrderStatus.Filled) {
      if (o.positionSide === OrderPositionSide.Long) {
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
      } else if (o.positionSide === OrderPositionSide.Short) {
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
}

async function _closeOrphanOrders() {
  const orders = await db.getOpenOrders(config.botId)
  for (const o of orders) {
    if (!o.openTime || !o.positionSide) continue

    const diff = difference(o.openTime, new Date(), { units: ['minutes'] })
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

async function closeAll() {
  const orders = await db.getOpenOrders(config.botId)
  for (const o of orders) {
    if (await redis.get(RedisKeys.Order(config.exchange))) return

    if (o.status === OrderStatus.New) {
      await redis.set(
        RedisKeys.Order(config.exchange),
        JSON.stringify({ ...o, status: OrderStatus.Canceled })
      )
      return
    } else if (o.status === OrderStatus.Filled) {
      const order =
        o.positionSide === OrderPositionSide.Long
          ? buildMarketOrder(o.symbol, OrderSide.Sell, OrderPositionSide.Long, o.qty, o.id)
          : buildMarketOrder(o.symbol, OrderSide.Buy, OrderPositionSide.Short, o.qty, o.id)
      await redis.set(RedisKeys.Order(config.exchange), JSON.stringify(order))
      return
    }
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

function main() {
  if (config.closeAll) {
    closeAll()
    gracefulShutdown([])
    return
  }

  const id1 = setInterval(() => createLongLimits(), 2000)

  const id2 = setInterval(() => createShortLimits(), 2000)

  const id3 = setInterval(() => createLongStops(), 2000)

  const id4 = setInterval(() => createShortStops(), 2000)

  const id5 = setInterval(() => monitorPnL(), 2000)

  const id6 = setInterval(() => cancelTimedOutOrders(), 60000)

  const id7 = setInterval(() => clearOutdatedOrders(), 10000)

  // const id8 = setInterval(() => closeOrphanOrders(), 10000)

  gracefulShutdown([id1, id2, id3, id4, id5, id6, id7])
}

main()
