import { datetime, redis } from '../../deps.ts'

import { OrderPositionSide, OrderSide, OrderStatus, OrderType } from '../../consts/index.ts'
import { PostgreSQL } from '../../db/pgbf.ts'
import { getMarkPrice, getSymbolInfo, RedisKeys } from '../../db/redis.ts'
import { Interval } from '../../exchange/binance/enums.ts'
import { PrivateApi } from '../../exchange/binance/futures.ts'
import { round, toNumber } from '../../helper/number.ts'
import { calcStopLower, calcStopUpper } from '../../helper/price.ts'
import { Order, QueryOrder, SymbolInfo } from '../../types/index.ts'
import { TaValues } from '../type.ts'
import { Config, getConfig, MIN_INTERVAL } from './config.ts'

const config: Config = {
  ...(await getConfig()),
  botId: '2',
  maTimeframe: Interval.H4,
  quoteQty: 3,
  orderGapAtr: 0.3,
  maxOrders: 3,
}

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
  tad: TaValues
  tah: TaValues
  info: SymbolInfo
  markPrice: number
}
async function prepare(symbol: string): Promise<Prepare | null> {
  const _tad = await redisc.get(RedisKeys.TA(config.exchange, symbol, Interval.D1))
  if (!_tad) return null
  const tad: TaValues = JSON.parse(_tad)
  if (tad.atr === 0) return null

  const _tah = await redisc.get(RedisKeys.TA(config.exchange, symbol, config.maTimeframe))
  if (!_tah) return null
  const tah: TaValues = JSON.parse(_tah)
  if (tah.atr === 0) return null

  const info = await getSymbolInfo(redisc, config.exchange, symbol)
  if (!info?.pricePrecision) return null

  const markPrice = await getMarkPrice(redisc, config.exchange, symbol, 5)
  if (markPrice === 0) return null

  return { tad, tah, info, markPrice }
}

function getSymbols() {
  return config.included
}

async function gap(symbol: string, type: string, gap: number): Promise<number> {
  const count = await redisc.get(RedisKeys.Failed(config.exchange, config.botId, symbol, type))
  return count ? toNumber(count) * 10 + gap : gap
}

async function createLongLimits() {
  if (!config.openOrder) return
  if (await redisc.get(RedisKeys.Order(config.exchange))) return

  const _orders = await db.getOpenOrders(config.botId)
  const openSymbols = [...new Set(_orders.map((o) => o.symbol))]
  const symbols = getSymbols()
  for (const symbol of symbols) {
    if (config.excluded.includes(symbol)) continue
    if (!openSymbols.includes(symbol) && openSymbols.length >= config.sizeActive) continue

    const p = await prepare(symbol)
    if (!p) continue
    const { tad, tah, info, markPrice: mp } = p

    if (tad.lsl_0 < 0 || tad.l_0 < tad.l_1 || mp > tad.hma_0 - tad.atr * 0.2) continue
    if (tah.lsl_0 < 0) continue
    if (mp > tah.cma_0) continue

    const _price = mp - tah.atr * 0.25

    const siblings = await db.getSiblingOrders({
      symbol,
      botId: config.botId,
      positionSide: OrderPositionSide.Long,
    })
    if (siblings.length >= config.maxOrders) continue
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
      hma: round(tah.hma_0, info.pricePrecision),
      cma: round(tah.cma_0, info.pricePrecision),
      lma: round(tah.lma_0, info.pricePrecision),
    })
    // console.log(config.botId, 'LONG', symbol, price, { note: order.note }, '\n')
    await redisc.set(RedisKeys.Order(config.exchange), JSON.stringify(order))
    return
  }
}

async function createShortLimits() {
  if (!config.openOrder) return
  if (await redisc.get(RedisKeys.Order(config.exchange))) return

  const _orders = await db.getOpenOrders(config.botId)
  const openSymbols = [...new Set(_orders.map((o) => o.symbol))]
  const symbols = getSymbols()
  for (const symbol of symbols) {
    if (config.excluded.includes(symbol)) continue
    if (!openSymbols.includes(symbol) && openSymbols.length >= config.sizeActive) continue

    const p = await prepare(symbol)
    if (!p) continue
    const { tad, tah, info, markPrice: mp } = p

    if (tad.hsl_0 > 0 || tad.h_0 > tad.h_1 || mp < tad.lma_0 + tad.atr * 0.2) continue
    if (tah.hsl_0 > 0) continue
    if (mp < tah.cma_0) continue

    const _price = mp + tah.atr * 0.25

    const siblings = await db.getSiblingOrders({
      symbol,
      botId: config.botId,
      positionSide: OrderPositionSide.Short,
    })
    if (siblings.length >= config.maxOrders) continue
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
      hma: round(tah.hma_0, info.pricePrecision),
      cma: round(tah.cma_0, info.pricePrecision),
      lma: round(tah.lma_0, info.pricePrecision),
    })
    // console.log(config.botId, 'SHORT', symbol, price, { note: order.note }, '\n')
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
    const { tad, tah, info, markPrice } = p

    const shouldSL = tad.lsl_0 < 0

    const slMin = tah.atr * config.slMinAtr
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
    const { tad, tah, info, markPrice } = p

    const shouldSL = tad.hsl_0 > 0

    const slMin = tah.atr * config.slMinAtr
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
  // if (Date.now()) return
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
    const { tah } = p

    if (Math.abs(p.markPrice - o.openPrice) < tah.atr * config.orderGapAtr) continue

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
  const id1 = setInterval(() => createLongLimits(), MIN_INTERVAL)

  const id2 = setInterval(() => createShortLimits(), MIN_INTERVAL)

  const id3 = setInterval(() => createLongStops(), MIN_INTERVAL)

  const id4 = setInterval(() => createShortStops(), MIN_INTERVAL)

  const id5 = setInterval(() => cancelTimedOutOrders(), 10 * datetime.SECOND)

  gracefulShutdown([id1, id2, id3, id4, id5])
}

finder()
