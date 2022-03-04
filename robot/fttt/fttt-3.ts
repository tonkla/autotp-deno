import { connect } from 'https://deno.land/x/redis@v0.25.3/mod.ts'

import { OrderSide, OrderPositionSide, OrderStatus, OrderType } from '../../consts/index.ts'
import { PostgreSQL } from '../../db/pgbf.ts'
import { RedisKeys, getMarkPrice, getSymbolInfo } from '../../db/redis.ts'
import { Interval } from '../../exchange/binance/enums.ts'
import { PrivateApi } from '../../exchange/binance/futures.ts'
import { round, toNumber } from '../../helper/number.ts'
import { calcStopLower, calcStopUpper } from '../../helper/price.ts'
import { Order, QueryOrder, SymbolInfo, TaValues } from '../../types/index.ts'
import { getConfig } from './config.ts'

const config = await getConfig()

const db = await new PostgreSQL().connect(config.dbUri)

const redis = await connect({ hostname: '127.0.0.1', port: 6379 })

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
): Promise<{ taH4: TaValues; taH1: TaValues; info: SymbolInfo; markPrice: number } | null> {
  const _taH4 = await redis.get(RedisKeys.TA(config.exchange, symbol, Interval.H4))
  if (!_taH4) return null
  const taH4: TaValues = JSON.parse(_taH4)

  const _taH1 = await redis.get(RedisKeys.TA(config.exchange, symbol, Interval.H1))
  if (!_taH1) return null
  const taH1: TaValues = JSON.parse(_taH1)

  if (taH4.atr === 0 || config.orderGapAtr === 0) return null

  const info = await getSymbolInfo(redis, config.exchange, symbol)
  if (!info?.pricePrecision) return null

  const markPrice = await getMarkPrice(redis, config.exchange, symbol, 5)
  if (markPrice === 0) return null

  return { taH4, taH1, info, markPrice }
}

async function getSymbols(): Promise<string[]> {
  const orders = await db.getOpenOrders(config.botId)
  const symbols: string[] = orders.map((o) => o.symbol)

  const _vols = await redis.get(RedisKeys.TopVols(config.exchange))
  if (_vols) {
    const vols = JSON.parse(_vols)
    if (Array.isArray(vols)) symbols.push(...vols)
  }

  return [...new Set(symbols)].filter((s) => s !== 'BNBUSDT')
}

function shouldOpenLong(taH4: TaValues, taH1: TaValues) {
  return (
    taH4.hma_1 < taH4.hma_0 &&
    taH4.lma_1 < taH4.lma_0 &&
    taH1.hma_1 < taH1.hma_0 &&
    taH1.lma_1 < taH1.lma_0 &&
    (taH4.c_0 < taH4.c_1 || taH4.c_0 < taH4.hma_0) &&
    taH4.c_0 < taH4.hma_0 + taH4.atr * 0.5
  )
}

function shouldOpenShort(taH4: TaValues, taH1: TaValues) {
  return (
    taH4.hma_1 > taH4.hma_0 &&
    taH4.lma_1 > taH4.lma_0 &&
    taH1.hma_1 > taH1.hma_0 &&
    taH1.lma_1 > taH1.lma_0 &&
    (taH4.c_0 > taH4.c_1 || taH4.c_0 > taH4.lma_0) &&
    taH4.c_0 > taH4.lma_0 - taH4.atr * 0.5
  )
}

function shouldStopLong(_taH4: TaValues, _taH1: TaValues) {
  // return taH4.cma_1 > taH4.cma_0 && taH1.hma_1 > taH1.hma_0 && taH1.lma_1 > taH1.lma_0
  return false
}

function shouldStopShort(_taH4: TaValues, _taH1: TaValues) {
  // return taH4.cma_1 < taH4.cma_0 && taH1.hma_1 < taH1.hma_0 && taH1.lma_1 < taH1.lma_0
  return false
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
    const { taH4, taH1, info, markPrice } = p

    if (shouldOpenLong(taH4, taH1)) {
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
        (norder.openPrice <= 0 || norder.openPrice - price < taH4.atr * config.orderGapAtr)
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
    const { taH4, taH1, info, markPrice } = p

    if (shouldOpenShort(taH4, taH1)) {
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
      if (norder && price - norder.openPrice < taH4.atr * config.orderGapAtr) continue

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

    const pr = (await exchange.getPositionRisks(o.symbol)).find(
      (p) => p.positionSide === OrderPositionSide.Long
    )
    if (toNumber(pr?.positionAmt ?? 0) === 0) continue

    const p = await prepare(o.symbol)
    if (!p) continue
    const { taH4, taH1, info, markPrice } = p

    if (shouldStopLong(taH4, taH1)) {
      const slo = await db.getStopOrder(o.id)
      if (slo) {
        if (slo.type === OrderType.FTP) {
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

    const sl = taH4.atr * config.slAtr
    if (sl > 0 && o.openPrice - markPrice > sl && !(await db.getStopOrder(o.id))) {
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

    const tp = taH4.atr * config.tpAtr
    if (tp > 0 && markPrice - o.openPrice > tp && !(await db.getStopOrder(o.id))) {
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

    const pr = (await exchange.getPositionRisks(o.symbol)).find(
      (p) => p.positionSide === OrderPositionSide.Short
    )
    if (toNumber(pr?.positionAmt ?? 0) === 0) continue

    const p = await prepare(o.symbol)
    if (!p) continue
    const { taH4, taH1, info, markPrice } = p

    if (shouldStopShort(taH4, taH1)) {
      const slo = await db.getStopOrder(o.id)
      if (slo) {
        if (slo.type === OrderType.FTP) {
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

    const sl = taH4.atr * config.slAtr
    if (sl > 0 && markPrice - o.openPrice > sl && !(await db.getStopOrder(o.id))) {
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

    const tp = taH4.atr * config.tpAtr
    if (tp > 0 && o.openPrice - markPrice > tp && !(await db.getStopOrder(o.id))) {
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

async function closeAll() {
  const orders = await db.getOpenOrders(config.botId)
  for (const o of orders) {
    if (o.status === OrderStatus.New) {
      const oo = await exchange.cancelOrder(o.symbol, o.id, o.refId)
      if (oo) {
        await db.updateOrder({
          ...o,
          status: oo.status,
          updateTime: oo.updateTime,
          closeTime: oo.updateTime,
        })
      }
    } else if (o.status === OrderStatus.Filled) {
      const oo = await exchange.placeMarketOrder(o)
      if (oo && typeof oo !== 'number') {
        await db.updateOrder({ ...oo, closeTime: new Date() })
      }
    }
  }
}

function clean(intervalIds: number[]) {
  for (const id of intervalIds) {
    clearInterval(id)
  }
  db.close()
  redis.close()
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
  const id1 = setInterval(() => createLongLimits(), 2000)

  createShortLimits()
  const id2 = setInterval(() => createShortLimits(), 2000)

  createLongStops()
  const id3 = setInterval(() => createLongStops(), 2000)

  createShortStops()
  const id4 = setInterval(() => createShortStops(), 2000)

  gracefulShutdown([id1, id2, id3, id4])
}

main()
