import { difference } from 'https://deno.land/std@0.148.0/datetime/mod.ts'
import { connect } from 'https://deno.land/x/redis@v0.26.0/mod.ts'

import { KV, OrderPositionSide, OrderSide, OrderStatus, OrderType } from '../../consts/index.ts'
import { PostgreSQL } from '../../db/pgbf.ts'
import { getMarkPrice, getSymbolInfo, RedisKeys } from '../../db/redis.ts'
import { Interval } from '../../exchange/binance/enums.ts'
import { PrivateApi } from '../../exchange/binance/futures.ts'
import { round, toNumber } from '../../helper/number.ts'
import { calcStopLower, calcStopUpper } from '../../helper/price.ts'
import { Order, PositionRisk, QueryOrder, SymbolInfo, TaValues_v3 } from '../../types/index.ts'
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

function buildMarketOrder(symbol: string, positionSide: string, qty: number): Order {
  const side = positionSide === OrderPositionSide.Long ? OrderSide.Sell : OrderSide.Buy
  const order: Order = {
    exchange: '',
    botId: '',
    id: '',
    refId: '',
    symbol,
    side,
    positionSide,
    type: OrderType.Market,
    status: OrderStatus.New,
    qty: Math.abs(qty),
    openPrice: 0,
    closePrice: 0,
    commission: 0,
    pl: 0,
  }
  return order
}

interface Prepare {
  ta: TaValues_v3
  info: SymbolInfo
  markPrice: number
}
async function prepare(symbol: string): Promise<Prepare | null> {
  const _ta = await redis.get(RedisKeys.TA(config.exchange, symbol))
  if (!_ta) return null
  const ta: TaValues_v3 = JSON.parse(_ta)
  if (ta.w.atr === 0 && ta.d.atr === 0) return null

  const info = await getSymbolInfo(redis, config.exchange, symbol)
  if (!info) return null

  const markPrice = await getMarkPrice(redis, config.exchange, symbol, 5)
  if (markPrice === 0) return null

  return { ta, info, markPrice }
}

async function gap(symbol: string, type: string, gap: number): Promise<number> {
  const count = await redis.get(RedisKeys.Failed(config.exchange, config.botId, symbol, type))
  return count ? toNumber(count) * 10 + gap : gap
}

async function getSymbols(): Promise<{ longs: string[]; shorts: string[]; symbols: string[] }> {
  const orders = await db.getAllOpenOrders()
  const longs: string[] = orders
    .filter((o) => o.positionSide === OrderPositionSide.Long)
    .map((o) => o.symbol)
  const shorts: string[] = orders
    .filter((o) => o.positionSide === OrderPositionSide.Short)
    .map((o) => o.symbol)

  const _topLongs = await redis.get(RedisKeys.TopLongs(config.exchange))
  if (_topLongs) {
    const topLongs = JSON.parse(_topLongs)
    if (Array.isArray(topLongs)) {
      longs.push(...topLongs.filter((s) => !config.excluded?.includes(s)))
    }
  }

  const _topShorts = await redis.get(RedisKeys.TopShorts(config.exchange))
  if (_topShorts) {
    const topShorts = JSON.parse(_topShorts)
    if (Array.isArray(topShorts)) {
      shorts.push(...topShorts.filter((s) => !config.excluded?.includes(s)))
    }
  }

  const _longs = [...new Set(longs)].slice(0, config.sizeActive)
  const _shorts = [...new Set(shorts)].slice(0, config.sizeActive)
  const _included = Array.isArray(config.included) ? config.included : []

  return {
    longs: _longs,
    shorts: _shorts,
    symbols: [..._included, ..._shorts, ..._longs],
  }
}

function shouldOpenLong({ w, h }: TaValues_v3): boolean {
  return (
    w.hma_1 < w.hma_0 &&
    w.lma_1 < w.lma_0 &&
    w.c > 0 &&
    w.c < w.hma_0 - w.atr * 0.5 &&
    h.hma_1 < h.hma_0 &&
    h.lma_1 < h.lma_0
  )
}

function shouldOpenShort({ w, h }: TaValues_v3): boolean {
  return (
    w.hma_1 > w.hma_0 &&
    w.lma_1 > w.lma_0 &&
    w.c > w.lma_0 + w.atr * 0.5 &&
    h.hma_1 > h.hma_0 &&
    h.lma_1 > h.lma_0
  )
}

async function createLongLimits() {
  if (!config.openOrder) return
  const kv = await db.getKV(KV.LatestStop)
  if (kv?.v) return

  const _orders = await db.getOpenOrders(config.botId)
  const openSymbols = [...new Set(_orders.map((o) => o.symbol))]
  const { longs } = await getSymbols()
  for (const symbol of longs) {
    if (await redis.get(RedisKeys.Order(config.exchange))) return
    if (config.excluded?.includes(symbol)) continue
    if (!openSymbols.includes(symbol) && openSymbols.length >= config.sizeActive) continue

    const p = await prepare(symbol)
    if (!p) continue
    const { ta, info, markPrice } = p

    if (!shouldOpenLong(ta)) continue

    const siblings = await db.getSiblingOrders({
      symbol,
      botId: config.botId,
      positionSide: OrderPositionSide.Long,
    })

    if (siblings.length >= config.maxOrders) continue

    const price = calcStopLower(
      markPrice,
      await gap(symbol, OrderType.Limit, config.openLimit),
      info.pricePrecision
    )

    if (siblings.find((o) => Math.abs(o.openPrice - price) < ta.d.atr * config.orderGapAtr))
      continue

    const qty = round((config.quoteQty / price) * config.leverage, info.qtyPrecision)
    const order = buildLimitOrder(symbol, OrderSide.Buy, OrderPositionSide.Long, price, qty)
    await redis.set(RedisKeys.Order(config.exchange), JSON.stringify(order))
    return
  }
}

async function createShortLimits() {
  if (!config.openOrder) return
  const kv = await db.getKV(KV.LatestStop)
  if (kv?.v) return

  const _orders = await db.getOpenOrders(config.botId)
  const openSymbols = [...new Set(_orders.map((o) => o.symbol))]
  const { shorts } = await getSymbols()
  for (const symbol of shorts) {
    if (await redis.get(RedisKeys.Order(config.exchange))) return
    if (config.excluded?.includes(symbol)) continue
    if (!openSymbols.includes(symbol) && openSymbols.length >= config.sizeActive) continue

    const p = await prepare(symbol)
    if (!p) continue
    const { ta, info, markPrice } = p

    if (!shouldOpenShort(ta)) continue

    const siblings = await db.getSiblingOrders({
      symbol,
      botId: config.botId,
      positionSide: OrderPositionSide.Short,
    })

    if (siblings.length >= config.maxOrders) continue

    const price = calcStopUpper(
      markPrice,
      await gap(symbol, OrderType.Limit, config.openLimit),
      info.pricePrecision
    )

    if (siblings.find((o) => Math.abs(o.openPrice - price) < ta.d.atr * config.orderGapAtr))
      continue

    const qty = round((config.quoteQty / price) * config.leverage, info.qtyPrecision)
    const order = buildLimitOrder(symbol, OrderSide.Sell, OrderPositionSide.Short, price, qty)
    await redis.set(RedisKeys.Order(config.exchange), JSON.stringify(order))
    return
  }
}

async function createLongStops() {
  if (config.slMinAtr === 0 && config.tpMinAtr === 0) return

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
    const {
      ta: { d },
      info,
      markPrice,
    } = p

    const slMin = d.atr * config.slMinAtr
    const shouldSl = d.hma_1 > d.hma_0 && d.lma_1 > d.lma_0
    if (
      ((slMin > 0 && o.openPrice - markPrice > slMin) || shouldSl) &&
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

    const tpMin = d.atr * config.tpMinAtr
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
  if (config.slMinAtr === 0 && config.tpMinAtr === 0) return

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
    const {
      ta: { d },
      info,
      markPrice,
    } = p

    const slMin = d.atr * config.slMinAtr
    const shouldSL = d.hma_1 < d.hma_0 && d.lma_1 < d.lma_0
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

    const tpMin = d.atr * config.tpMinAtr
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

async function closeOrders(orders: Order[]) {
  for (const o of orders) {
    if (o.type === OrderType.Limit) {
      if (o.status !== OrderStatus.Filled) continue
      const markPrice = await getMarkPrice(redis, config.exchange, o.symbol)
      const pip =
        o.positionSide === OrderPositionSide.Long
          ? markPrice - o.openPrice
          : o.openPrice - markPrice
      const oo: Order = {
        ...o,
        pl: round(pip * o.qty - o.commission * 2, 4),
        closePrice: markPrice,
        closeTime: new Date(),
      }
      await db.updateOrder(oo)
    } else {
      if (o.status === OrderStatus.New) {
        await exchange.cancelOrder(o.symbol, o.id, o.refId)
      }
      await db.updateOrder({ ...o, closeTime: new Date() })
    }
  }
}

async function closeByUSD(orders: Order[]) {
  if (config.singleLossUSD === 0 && config.singleProfitUSD === 0) return

  const _positions = await redis.get(RedisKeys.Positions(config.exchange))
  if (!_positions) return
  const positions: PositionRisk[] = JSON.parse(_positions)
  for (const p of positions) {
    if (p.positionAmt === 0) continue

    const _orders = orders.filter((o) => o.symbol === p.symbol && o.positionSide === p.positionSide)
    const pl = _orders
      .map(
        (o) =>
          (o.positionSide === OrderPositionSide.Long
            ? p.markPrice - o.openPrice
            : o.openPrice - p.markPrice) *
            o.qty -
          o.commission
      )
      .reduce((a, b) => a + b, 0)

    if (
      (config.singleLossUSD < 0 && pl < config.singleLossUSD) ||
      (config.singleProfitUSD > 0 && pl > config.singleProfitUSD)
    ) {
      await exchange.placeMarketOrder(buildMarketOrder(p.symbol, p.positionSide, p.positionAmt))
      await closeOrders(_orders)
    }
  }
}

async function closeByATR(orders: Order[]) {
  if (config.singleLossAtr === 0 && config.singleProfitAtr === 0) return

  const _positions = await redis.get(RedisKeys.Positions(config.exchange))
  if (!_positions) return
  const positions: PositionRisk[] = JSON.parse(_positions)
  for (const p of positions) {
    if (p.positionAmt === 0) continue

    const _ta = await redis.get(RedisKeys.TA(config.exchange, p.symbol, Interval.D1))
    if (!_ta) continue
    const ta: TaValues_v3 = JSON.parse(_ta)
    if (ta.d.atr === 0) continue

    const _orders = orders.filter((o) => o.symbol === p.symbol && o.positionSide === p.positionSide)
    const pip = _orders
      .map((o) =>
        o.positionSide === OrderPositionSide.Long
          ? p.markPrice - o.openPrice
          : o.openPrice - p.markPrice
      )
      .reduce((a, b) => a + b, 0)
    const pAtr = pip / ta.d.atr

    if (
      (config.singleLossAtr < 0 && pAtr < config.singleLossAtr) ||
      (config.singleProfitAtr > 0 && pAtr > config.singleProfitAtr)
    ) {
      await exchange.placeMarketOrder(buildMarketOrder(p.symbol, p.positionSide, p.positionAmt))
      await closeOrders(_orders)
    }
  }
}

async function closeAll() {
  const orders = await db.getOpenOrders(config.botId)
  await closeByUSD(orders)
  await closeByATR(orders)
}

async function monitorPnL() {
  if (![0, 1].includes(new Date().getSeconds())) return

  let lpl = 0
  const longs = await db.getLongFilledOrders(qo)
  for (const o of longs) {
    const p = await prepare(o.symbol)
    if (!p) continue
    lpl += (p.markPrice - o.openPrice) * o.qty - o.commission
  }
  // await redis.set(RedisKeys.PnL(config.exchange, config.botId, OrderPositionSide.Long), lpl)

  let spl = 0
  const shorts = await db.getShortFilledOrders(qo)
  for (const o of shorts) {
    const p = await prepare(o.symbol)
    if (!p) continue
    spl += (o.openPrice - p.markPrice) * o.qty - o.commission
  }
  // await redis.set(RedisKeys.PnL(config.exchange, config.botId, OrderPositionSide.Short), spl)

  console.info('\n', {
    L: [longs.length, round(lpl, 2)],
    S: [shorts.length, round(spl, 2)],
    T: round(lpl + spl, 2),
  })
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

    if (Math.abs(ta.h.c - o.openPrice) < ta.d.atr * config.orderGapAtr * 2) continue

    await redis.set(
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

function main() {
  const id1 = setInterval(() => createLongLimits(), 3000)

  const id2 = setInterval(() => createShortLimits(), 3000)

  const id3 = setInterval(() => createLongStops(), 3000)

  const id4 = setInterval(() => createShortStops(), 3000)

  const id5 = setInterval(() => closeAll(), 5000)

  const id6 = setInterval(() => monitorPnL(), 2000)

  const id7 = setInterval(() => cancelTimedOutOrders(), 60000)

  gracefulShutdown([id1, id2, id3, id4, id5, id6, id7])
}

main()
