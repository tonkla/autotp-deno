import { difference } from 'https://deno.land/std@0.135.0/datetime/mod.ts'
import { connect } from 'https://deno.land/x/redis@v0.25.4/mod.ts'

import { OrderSide, OrderPositionSide, OrderStatus, OrderType } from '../../consts/index.ts'
import { PostgreSQL } from '../../db/pgbf.ts'
import { RedisKeys, getMarkPrice, getSymbolInfo } from '../../db/redis.ts'
import { Interval } from '../../exchange/binance/enums.ts'
import { PrivateApi } from '../../exchange/binance/futures.ts'
import { round, toNumber } from '../../helper/number.ts'
import { calcStopLower, calcStopUpper } from '../../helper/price.ts'
import {
  Order,
  PriceChange,
  PositionRisk,
  QueryOrder,
  SymbolInfo,
  TaValues,
} from '../../types/index.ts'
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

interface Prepare {
  tad: TaValues
  tah: TaValues
  pc: PriceChange
  info: SymbolInfo
  markPrice: number
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

  const _pc = await redis.get(RedisKeys.PriceChange(config.exchange, symbol))
  if (!_pc) return null
  const pc: PriceChange = JSON.parse(_pc)
  if (!pc?.h1?.pcHL) return null

  const info = await getSymbolInfo(redis, config.exchange, symbol)
  if (!info?.pricePrecision) return null

  const markPrice = await getMarkPrice(redis, config.exchange, symbol, 5)
  if (markPrice === 0) return null

  return { tad, tah, pc, info, markPrice }
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

function shouldOpenLong(tad: TaValues, tah: TaValues) {
  return tad.cma_1 < tad.cma_0 && tah.c_0 < tah.lma_0 + tah.atr * 0.2
}

function shouldOpenShort(tad: TaValues, tah: TaValues) {
  return tad.cma_1 > tad.cma_0 && tah.c_0 > tah.hma_0 - tah.atr * 0.2
}

function shouldSLLong(tad: TaValues) {
  return tad.cma_1 > tad.cma_0
}

function shouldSLShort(tad: TaValues) {
  return tad.cma_1 < tad.cma_0
}

function shouldTPLong(pc: PriceChange) {
  return pc.h1.pcHL > 99
}

function shouldTPShort(pc: PriceChange) {
  return pc.h1.pcHL < 1
}

function shouldTS(_o: Order, _price: number, _atr: number) {
  return false
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
  const orders = await db.getOpenOrders(config.botId)
  if ([...new Set(orders.map((o) => o.symbol))].length >= config.sizeActive) return

  const symbols = await getSymbols()
  for (const symbol of symbols) {
    if (await redis.get(RedisKeys.Order(config.exchange))) return

    const p = await prepare(symbol)
    if (!p) continue
    const { tad, tah, info, markPrice } = p

    if (!shouldOpenLong(tad, tah)) continue

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
      (norder.openPrice <= 0 || norder.openPrice - price < tah.atr * config.orderGapAtr)
    ) {
      continue
    }

    const qty = round((config.quoteQty / price) * config.leverage, info.qtyPrecision)
    const order = buildLimitOrder(symbol, OrderSide.Buy, OrderPositionSide.Long, price, qty)
    await redis.set(RedisKeys.Order(config.exchange), JSON.stringify(order))
    return
  }
}

async function createShortLimits() {
  const orders = await db.getOpenOrders(config.botId)
  if ([...new Set(orders.map((o) => o.symbol))].length >= config.sizeActive) return

  const symbols = await getSymbols()
  for (const symbol of symbols) {
    if (await redis.get(RedisKeys.Order(config.exchange))) return

    const p = await prepare(symbol)
    if (!p) continue
    const { tad, tah, info, markPrice } = p

    if (!shouldOpenShort(tad, tah)) continue

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
    if (norder && price - norder.openPrice < tah.atr * config.orderGapAtr) {
      continue
    }

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
    const { tad, tah, pc, info, markPrice } = p

    const slMin = tah.atr * config.slMinAtr
    const slMax = tah.atr * config.slMaxAtr
    if (
      ((shouldSLLong(tad) && o.openPrice - markPrice > slMin) ||
        (slMax > 0 && o.openPrice - markPrice > slMax) ||
        shouldTS(o, markPrice, tah.atr)) &&
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

    const tpMin = tah.atr * config.tpMinAtr
    if (
      shouldTPLong(pc) &&
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
    const { tad, tah, pc, info, markPrice } = p

    const slMin = tah.atr * config.slMinAtr
    const slMax = tah.atr * config.slMaxAtr
    if (
      ((shouldSLShort(tad) && markPrice - o.openPrice > slMin) ||
        (slMax > 0 && markPrice - o.openPrice > slMax) ||
        shouldTS(o, markPrice, tah.atr)) &&
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

    const tpMin = tah.atr * config.tpMinAtr
    if (
      shouldTPShort(pc) &&
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

async function cancelTimedOutOrders() {
  const orders = await db.getNewOrders(config.botId)
  for (const o of orders) {
    if (await redis.get(RedisKeys.Order(config.exchange))) return

    const exo = await exchange.getOrder(o.symbol, o.id, o.refId)
    if (!exo) continue
    if (exo.status !== OrderStatus.New) continue
    if (config.timeSecCancel <= 0 || !o.openTime) continue
    const diff = difference(o.openTime, new Date(), { units: ['seconds'] })
    if ((diff?.seconds ?? 0) > config.timeSecCancel) {
      await redis.set(
        RedisKeys.Order(config.exchange),
        JSON.stringify({ ...o, status: OrderStatus.Canceled })
      )
      return
    }
  }
}

async function closeOrphanOrders() {
  const orders = await db.getOpenOrders(config.botId)
  for (const o of orders) {
    if (!o.openTime || !o.positionSide) continue

    const diff = difference(o.openTime, new Date(), { units: ['minutes'] })
    if ((diff?.minutes ?? 0) < 360) continue // 6 hours

    const _pos = await redis.get(RedisKeys.Position(config.exchange, o.symbol, o.positionSide))
    if (!_pos) continue
    const pos: PositionRisk = JSON.parse(_pos)
    if (Math.abs(pos.positionAmt) >= o.qty) continue
    await db.updateOrder({ ...o, closeTime: new Date() })
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
        o.type === OrderPositionSide.Long
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

async function main() {
  if (config.closeAll) {
    closeAll()
    gracefulShutdown([])
    return
  }

  await redis.del(RedisKeys.Order(config.exchange))

  const id1 = setInterval(() => createLongLimits(), 2000)

  const id2 = setInterval(() => createShortLimits(), 2000)

  const id3 = setInterval(() => createLongStops(), 2000)

  const id4 = setInterval(() => createShortStops(), 2000)

  cancelTimedOutOrders()
  const id5 = setInterval(() => cancelTimedOutOrders(), 60000) // 1m

  closeOrphanOrders()
  const id6 = setInterval(() => closeOrphanOrders(), 600000) // 10m

  gracefulShutdown([id1, id2, id3, id4, id5, id6])
}

main()
