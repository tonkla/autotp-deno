import { difference } from 'https://deno.land/std@0.148.0/datetime/mod.ts'
import { connect } from 'https://deno.land/x/redis@v0.26.0/mod.ts'

import { OrderPositionSide, OrderSide, OrderStatus, OrderType } from '../../../consts/index.ts'
import { PostgreSQL } from '../../../db/pgbf.ts'
import { getMarkPrice, getSymbolInfo, RedisKeys } from '../../../db/redis.ts'
import { PrivateApi } from '../../../exchange/binance/futures.ts'
import { round, toNumber } from '../../../helper/number.ts'
import { calcStopLower, calcStopUpper } from '../../../helper/price.ts'
import { Order, PositionRisk, QueryOrder, SymbolInfo } from '../../../types/index.ts'
import { TaValuesX } from '../type.ts'
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
  if (!config.openOrder) return

  const _orders = await db.getOpenOrders(config.botId)
  const openSymbols = [...new Set(_orders.map((o) => o.symbol))]
  const symbols = await getSymbols()
  for (const symbol of symbols) {
    if (await redis.get(RedisKeys.Order(config.exchange))) return
    if (config.excluded.includes(symbol)) continue
    if (!openSymbols.includes(symbol) && openSymbols.length >= config.sizeActive) continue

    const p = await prepare(symbol)
    if (!p) continue
    const { ta, info, markPrice: mp } = p

    if (ta.hma_1 > ta.hma_0 || ta.lma_1 > ta.lma_0 || mp > ta.x_6) continue

    const _price =
      mp < ta.x_6 && mp > ta.x_5
        ? ta.x_5
        : mp < ta.x_5 && mp > ta.x_4
        ? ta.x_4
        : mp < ta.x_4 && mp > ta.x_3
        ? ta.x_3
        : mp < ta.x_3 && mp > ta.x_2
        ? ta.x_2
        : mp < ta.x_2 && mp > ta.x_1
        ? ta.x_1
        : mp < ta.x_1 && mp > ta.lma_0
        ? ta.lma_0
        : 0

    if (_price === 0) continue

    const siblings = await db.getSiblingOrders({
      symbol,
      botId: config.botId,
      positionSide: OrderPositionSide.Long,
    })
    if (siblings.find((o) => Math.abs(o.openPrice - _price) < ta.atr * config.orderGapAtr)) continue

    const price = round(_price, info.pricePrecision)
    const qty = round((config.quoteQty / price) * config.leverage, info.qtyPrecision)
    const order = buildLimitOrder(symbol, OrderSide.Buy, OrderPositionSide.Long, price, qty)
    await redis.set(RedisKeys.Order(config.exchange), JSON.stringify(order))
    return
  }
}

async function createShortLimits() {
  if (!config.openOrder) return

  const _orders = await db.getOpenOrders(config.botId)
  const openSymbols = [...new Set(_orders.map((o) => o.symbol))]
  const symbols = await getSymbols()
  for (const symbol of symbols) {
    if (await redis.get(RedisKeys.Order(config.exchange))) return
    if (config.excluded.includes(symbol)) continue
    if (!openSymbols.includes(symbol) && openSymbols.length >= config.sizeActive) continue

    const p = await prepare(symbol)
    if (!p) continue
    const { ta, info, markPrice: mp } = p

    if (ta.hma_1 < ta.hma_0 || ta.lma_1 < ta.lma_0 || mp < ta.x_4) continue

    const _price =
      mp > ta.x_4 && mp < ta.x_5
        ? ta.x_5
        : mp > ta.x_5 && mp < ta.x_6
        ? ta.x_6
        : mp > ta.x_6 && mp < ta.x_7
        ? ta.x_7
        : mp > ta.x_7 && mp < ta.x_8
        ? ta.x_8
        : mp > ta.x_8 && mp < ta.x_9
        ? ta.x_9
        : mp > ta.x_9 && mp < ta.hma_0
        ? ta.hma_0
        : 0

    if (_price === 0) continue

    const siblings = await db.getSiblingOrders({
      symbol,
      botId: config.botId,
      positionSide: OrderPositionSide.Short,
    })
    if (siblings.find((o) => Math.abs(o.openPrice - _price) < ta.atr * config.orderGapAtr)) continue

    const price = round(_price, info.pricePrecision)
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
    const shouldSL = (ta.hma_1 > ta.hma_0 || ta.lma_1 > ta.lma_0) && ta.c_0 > ta.lma_0
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
    const shouldSL = (ta.hma_1 < ta.hma_0 || ta.lma_1 < ta.lma_0) && ta.c_0 < ta.hma_0
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

  if ([0, 1].includes(new Date().getSeconds())) {
    console.info('\n', {
      L: [longs.length, round(lpl, 2)],
      S: [shorts.length, round(spl, 2)],
      T: round(lpl + spl, 2),
    })
  }
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

async function closeOrphanOrders() {
  if (!config.closeOrphan) return
  const orders = await db.getOpenOrders(config.botId)
  for (const o of orders) {
    if (!o.openTime || !o.positionSide) continue

    const diff = difference(o.openTime, new Date(), { units: ['minutes'] })
    if ((diff?.minutes ?? 0) < 60) continue

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

  const id6 = setInterval(() => cancelTimedOutOrders(), 10000)

  const id7 = setInterval(() => closeOrphanOrders(), 10000)

  gracefulShutdown([id1, id2, id3, id4, id5, id6, id7])
}

main()
