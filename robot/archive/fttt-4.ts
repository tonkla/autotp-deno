import { difference } from 'https://deno.land/std@0.128.0/datetime/mod.ts'
import { connect } from 'https://deno.land/x/redis@v0.25.3/mod.ts'

import { OrderSide, OrderPositionSide, OrderStatus, OrderType } from '../../consts/index.ts'
import { PostgreSQL } from '../../db/pgbf.ts'
import { RedisKeys, getMarkPrice, getSymbolInfo } from '../../db/redis.ts'
import { PrivateApi } from '../../exchange/binance/futures.ts'
import { round, toNumber } from '../../helper/number.ts'
import { calcStopLower, calcStopUpper } from '../../helper/price.ts'
import { Order, PositionRisk, QueryOrder, SymbolInfo, TaValues } from '../../types/index.ts'
import { getConfig } from './config.ts'

const config = await getConfig()

const db = await new PostgreSQL().connect(config.dbUri)

const redis = await connect({ hostname: '127.0.0.1', port: 6379 })

const exchange = new PrivateApi(config.apiKey, config.secretKey, redis)

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

async function prepare(
  symbol: string
): Promise<{ ta: TaValues; info: SymbolInfo; markPrice: number } | null> {
  const _ta = await redis.get(RedisKeys.TA(config.exchange, symbol, config.maTimeframe))
  if (!_ta) return null
  const ta: TaValues = JSON.parse(_ta)

  if (ta.atr === 0 || config.orderGapAtr === 0) return null

  const info = await getSymbolInfo(redis, config.exchange, symbol)
  if (!info?.pricePrecision) return null

  const markPrice = await getMarkPrice(redis, config.exchange, symbol, 5)
  if (markPrice === 0) return null

  return { ta, info, markPrice }
}

async function getSymbols(): Promise<string[]> {
  const orders = await db.getOpenOrders(config.botId)
  const symbols: string[] = orders.map((o) => o.symbol)

  const _topVols = await redis.get(RedisKeys.TopVols(config.exchange))
  if (_topVols) {
    const topVols = JSON.parse(_topVols)
    if (Array.isArray(topVols)) symbols.push(...topVols)
  }

  return [...new Set(symbols)].filter((s) => s !== 'BNBUSDT')
}

function shouldOpenLong(ta: TaValues) {
  return ta.slope > config.openSlope && ta.c_0 < ta.hma_0 + (ta.cma_0 - ta.cma_1) * 0.75
}

function shouldOpenShort(ta: TaValues) {
  return ta.slope < -config.openSlope && ta.c_0 > ta.lma_0 - (ta.cma_1 - ta.cma_0) * 0.75
}

function shouldStopLong(_ta: TaValues) {
  return false // ta.slope < 0
}

function shouldStopShort(_ta: TaValues) {
  return false // ta.slope > 0
}

async function gap(symbol: string, type: string, gap: number): Promise<number> {
  const _count = await redis.get(RedisKeys.Failed(config.exchange, config.botId, symbol, type))
  return _count ? toNumber(_count) * 10 + gap : gap
}

async function createLongLimits() {
  const orders = await db.getOpenOrders(config.botId)
  if ([...new Set(orders.map((o) => o.symbol))].length >= config.sizeActive) return

  const symbols = await getSymbols()
  for (const symbol of symbols) {
    if ((await redis.sismember(RedisKeys.Waiting(config.exchange, config.botId), symbol)) > 0)
      continue

    const p = await prepare(symbol)
    if (!p) continue
    const { ta, info, markPrice } = p

    if (shouldOpenLong(ta)) {
      const price = calcStopLower(
        markPrice,
        await gap(symbol, OrderType.Limit, config.openLimit),
        info.pricePrecision
      )
      if (price <= 0) continue

      const norder = await db.getNearestOrder({
        symbol,
        botId: config.botId,
        positionSide: OrderPositionSide.Long,
        openPrice: price,
      })
      if (
        norder &&
        (norder.openPrice <= 0 || norder.openPrice - price < ta.atr * config.orderGapAtr)
      ) {
        continue
      }

      const qty = round((config.quoteQty / price) * config.leverage, info.qtyPrecision)
      const order = buildLimitOrder(symbol, OrderSide.Buy, OrderPositionSide.Long, price, qty)
      await redis.rpush(RedisKeys.Orders(config.exchange), JSON.stringify(order))
      await redis.sadd(RedisKeys.Waiting(config.exchange, config.botId), order.symbol)
    }
  }
}

async function createShortLimits() {
  const orders = await db.getOpenOrders(config.botId)
  if ([...new Set(orders.map((o) => o.symbol))].length >= config.sizeActive) return

  const symbols = await getSymbols()
  for (const symbol of symbols) {
    if ((await redis.sismember(RedisKeys.Waiting(config.exchange, config.botId), symbol)) > 0)
      continue

    const p = await prepare(symbol)
    if (!p) continue
    const { ta, info, markPrice } = p

    if (shouldOpenShort(ta)) {
      const price = calcStopUpper(
        markPrice,
        await gap(symbol, OrderType.Limit, config.openLimit),
        info.pricePrecision
      )
      if (price <= 0) continue

      const norder = await db.getNearestOrder({
        symbol,
        botId: config.botId,
        positionSide: OrderPositionSide.Short,
        openPrice: price,
      })
      if (norder && price - norder.openPrice < ta.atr * config.orderGapAtr) continue

      const qty = round((config.quoteQty / price) * config.leverage, info.qtyPrecision)
      const order = buildLimitOrder(symbol, OrderSide.Sell, OrderPositionSide.Short, price, qty)
      await redis.rpush(RedisKeys.Orders(config.exchange), JSON.stringify(order))
      await redis.sadd(RedisKeys.Waiting(config.exchange, config.botId), order.symbol)
    }
  }
}

async function createLongStops() {
  const orders = await db.getLongFilledOrders(qo)
  for (const o of orders) {
    if ((await redis.sismember(RedisKeys.Waiting(config.exchange, config.botId), o.symbol)) > 0)
      continue

    const _pos = await redis.get(
      RedisKeys.Position(config.exchange, o.symbol, o.positionSide ?? '')
    )
    if (!_pos) continue
    const pos: PositionRisk = JSON.parse(_pos)
    if (Math.abs(pos.positionAmt) < o.qty) continue

    const p = await prepare(o.symbol)
    if (!p) continue
    const { ta, info, markPrice } = p

    if (shouldStopLong(ta)) {
      const slo = await db.getStopOrder(o.id, OrderType.FTP)
      if (slo) {
        if (slo.type === OrderType.FTP && slo.status === OrderStatus.New) {
          await redis.rpush(
            RedisKeys.Orders(config.exchange),
            JSON.stringify({ ...slo, status: OrderStatus.Canceled })
          )
        }
      } else {
        const order = buildMarketOrder(
          o.symbol,
          OrderSide.Sell,
          OrderPositionSide.Long,
          o.qty,
          o.id
        )
        await redis.rpush(RedisKeys.Orders(config.exchange), JSON.stringify(order))
        await redis.sadd(RedisKeys.Waiting(config.exchange, config.botId), order.symbol)
      }
      continue
    }

    const sl = ta.atr * config.slAtr
    if (sl > 0 && o.openPrice - markPrice > sl && !(await db.getStopOrder(o.id, OrderType.FTP))) {
      const stopPrice = calcStopUpper(
        markPrice,
        await gap(o.symbol, OrderType.FTP, config.slStop),
        info.pricePrecision
      )
      const slPrice = calcStopUpper(
        markPrice,
        await gap(o.symbol, OrderType.FTP, config.slLimit),
        info.pricePrecision
      )
      if (slPrice <= 0) continue
      const order = buildStopOrder(
        o.symbol,
        OrderSide.Sell,
        OrderPositionSide.Long,
        OrderType.FTP,
        stopPrice,
        slPrice,
        o.qty,
        o.id
      )
      await redis.rpush(RedisKeys.Orders(config.exchange), JSON.stringify(order))
      await redis.sadd(RedisKeys.Waiting(config.exchange, config.botId), order.symbol)
      continue
    }

    const tp = ta.atr * config.tpAtr
    if (tp > 0 && markPrice - o.openPrice > tp && !(await db.getStopOrder(o.id, OrderType.FTP))) {
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
      await redis.rpush(RedisKeys.Orders(config.exchange), JSON.stringify(order))
      await redis.sadd(RedisKeys.Waiting(config.exchange, config.botId), order.symbol)
    }
  }
}

async function createShortStops() {
  const orders = await db.getShortFilledOrders(qo)
  for (const o of orders) {
    if ((await redis.sismember(RedisKeys.Waiting(config.exchange, config.botId), o.symbol)) > 0)
      continue

    const _pos = await redis.get(
      RedisKeys.Position(config.exchange, o.symbol, o.positionSide ?? '')
    )
    if (!_pos) continue
    const pos: PositionRisk = JSON.parse(_pos)
    if (Math.abs(pos.positionAmt) < o.qty) continue

    const p = await prepare(o.symbol)
    if (!p) continue
    const { ta, info, markPrice } = p

    if (shouldStopShort(ta)) {
      const slo = await db.getStopOrder(o.id, OrderType.FTP)
      if (slo) {
        if (slo.type === OrderType.FTP && slo.status === OrderStatus.New) {
          await redis.rpush(
            RedisKeys.Orders(config.exchange),
            JSON.stringify({ ...slo, status: OrderStatus.Canceled })
          )
        }
      } else {
        const order = buildMarketOrder(
          o.symbol,
          OrderSide.Buy,
          OrderPositionSide.Short,
          o.qty,
          o.id
        )
        await redis.rpush(RedisKeys.Orders(config.exchange), JSON.stringify(order))
        await redis.sadd(RedisKeys.Waiting(config.exchange, config.botId), order.symbol)
      }
      continue
    }

    const sl = ta.atr * config.slAtr
    if (sl > 0 && markPrice - o.openPrice > sl && !(await db.getStopOrder(o.id, OrderType.FTP))) {
      const stopPrice = calcStopLower(
        markPrice,
        await gap(o.symbol, OrderType.FTP, config.slStop),
        info.pricePrecision
      )
      const slPrice = calcStopLower(
        markPrice,
        await gap(o.symbol, OrderType.FTP, config.slLimit),
        info.pricePrecision
      )
      if (slPrice <= 0) continue
      const order = buildStopOrder(
        o.symbol,
        OrderSide.Buy,
        OrderPositionSide.Short,
        OrderType.FTP,
        stopPrice,
        slPrice,
        o.qty,
        o.id
      )
      await redis.rpush(RedisKeys.Orders(config.exchange), JSON.stringify(order))
      await redis.sadd(RedisKeys.Waiting(config.exchange, config.botId), order.symbol)
      continue
    }

    const tp = ta.atr * config.tpAtr
    if (tp > 0 && o.openPrice - markPrice > tp && !(await db.getStopOrder(o.id, OrderType.FTP))) {
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
      await redis.rpush(RedisKeys.Orders(config.exchange), JSON.stringify(order))
      await redis.sadd(RedisKeys.Waiting(config.exchange, config.botId), order.symbol)
    }
  }
}

async function cancelTimedOutOrders() {
  const orders = await db.getNewOrders(config.botId)
  for (const o of orders) {
    const exo = await exchange.getOrder(o.symbol, o.id, o.refId)
    if (!exo) continue
    if (exo.status !== OrderStatus.New) continue
    if (config.timeSecCancel <= 0 || !o.openTime) continue
    const diff = difference(o.openTime, new Date(), { units: ['seconds'] })
    if ((diff?.seconds ?? 0) > config.timeSecCancel) {
      await redis.rpush(
        RedisKeys.Orders(config.exchange),
        JSON.stringify({ ...o, status: OrderStatus.Canceled })
      )
    }
  }
}

async function closeAll() {
  const orders = await db.getOpenOrders(config.botId)
  for (const o of orders) {
    if (o.status === OrderStatus.New) {
      await redis.rpush(
        RedisKeys.Orders(config.exchange),
        JSON.stringify({ ...o, status: OrderStatus.Canceled })
      )
    } else if (o.status === OrderStatus.Filled) {
      const order =
        o.type === OrderPositionSide.Long
          ? buildMarketOrder(o.symbol, OrderSide.Sell, OrderPositionSide.Long, o.qty, o.id)
          : buildMarketOrder(o.symbol, OrderSide.Buy, OrderPositionSide.Short, o.qty, o.id)
      await redis.rpush(RedisKeys.Orders(config.exchange), JSON.stringify(order))
      await redis.sadd(RedisKeys.Waiting(config.exchange, config.botId), order.symbol)
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

async function main() {
  if (config.closeAll) {
    closeAll()
    gracefulShutdown([])
    return
  }

  await redis.del(RedisKeys.Orders(config.exchange))
  await redis.del(RedisKeys.Waiting(config.exchange, config.botId))

  createLongLimits()
  const id1 = setInterval(() => createLongLimits(), 3000)

  createShortLimits()
  const id2 = setInterval(() => createShortLimits(), 3000)

  createLongStops()
  const id3 = setInterval(() => createLongStops(), 3000)

  createShortStops()
  const id4 = setInterval(() => createShortStops(), 3000)

  cancelTimedOutOrders()
  const id5 = setInterval(() => cancelTimedOutOrders(), 60000) // 1m

  gracefulShutdown([id1, id2, id3, id4, id5])
}

main()