import { difference } from 'https://deno.land/std@0.138.0/datetime/mod.ts'
import { connect } from 'https://deno.land/x/redis@v0.25.5/mod.ts'

import { KV, OrderSide, OrderPositionSide, OrderStatus, OrderType } from '../../consts/index.ts'
import { PostgreSQL } from '../../db/pgbf.ts'
import { RedisKeys, getMarkPrice, getSymbolInfo } from '../../db/redis.ts'
import { Interval } from '../../exchange/binance/enums.ts'
import { PrivateApi } from '../../exchange/binance/futures.ts'
import { round, toNumber } from '../../helper/number.ts'
import { calcStopLower, calcStopUpper } from '../../helper/price.ts'
import {
  Order,
  PositionRisk,
  QueryOrder,
  SymbolInfo,
  TaValues_v3,
  TaMA,
  TaPC,
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

interface Prepare {
  ta: TaValues_v3
  info: SymbolInfo
  markPrice: number
}
async function prepare(symbol: string): Promise<Prepare | null> {
  const _ta = await redis.get(RedisKeys.TA(config.exchange, symbol))
  if (!_ta) return null
  const ta: TaValues_v3 = JSON.parse(_ta)
  if (ta.d.atr === 0) return null

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
  return {
    longs: _longs,
    shorts: _shorts,
    symbols: [..._shorts, ..._longs],
  }
}

type TaV = TaMA & TaPC

function shouldOpenLong(d: TaV): boolean {
  return (
    d.hma_1 < d.hma_0 &&
    d.lma_1 < d.lma_0 &&
    d.c < d.hma_0 - d.atr * 0.2 &&
    d.slope > 0.1 &&
    d.hc < 15
  )
}

function shouldOpenShort(d: TaV): boolean {
  return (
    d.hma_1 > d.hma_0 &&
    d.lma_1 > d.lma_0 &&
    d.c > d.lma_0 + d.atr * 0.2 &&
    d.slope < -0.1 &&
    d.cl < 15
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
    const {
      ta: { d },
      info,
      markPrice,
    } = p

    if (!shouldOpenLong(d)) continue

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

    if (siblings.find((o) => Math.abs(o.openPrice - price) < d.atr * config.orderGapAtr)) continue

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
    const {
      ta: { d },
      info,
      markPrice,
    } = p

    if (!shouldOpenShort(d)) continue

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

    if (siblings.find((o) => Math.abs(o.openPrice - price) < d.atr * config.orderGapAtr)) continue

    const qty = round((config.quoteQty / price) * config.leverage, info.qtyPrecision)
    const order = buildLimitOrder(symbol, OrderSide.Sell, OrderPositionSide.Short, price, qty)
    await redis.set(RedisKeys.Order(config.exchange), JSON.stringify(order))
    return
  }
}

async function closeByUSD(orders: Order[]) {
  if (config.singleLossUSD === 0 && config.singleProfitUSD === 0) return

  const _positions = await redis.get(RedisKeys.Positions(config.exchange))
  if (!_positions) return
  const positions: PositionRisk[] = JSON.parse(_positions)
  for (const p of positions) {
    if (p.positionAmt === 0) continue
    if (
      (config.singleLossUSD < 0 && p.unrealizedProfit < config.singleLossUSD) ||
      (config.singleProfitUSD > 0 && p.unrealizedProfit > config.singleProfitUSD)
    ) {
      const _pnl = orders
        .filter((o) => o.symbol === p.symbol && o.positionSide === p.positionSide)
        .map(
          (o) =>
            (o.positionSide === OrderPositionSide.Long
              ? p.markPrice - o.openPrice
              : o.openPrice - p.markPrice) *
              o.qty -
            o.commission
        )
        .reduce((a, b) => a + b, 0)
      console.log('closeByUSD', { symbol: p.symbol, pnl: _pnl })
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

    const pip =
      p.positionSide === OrderPositionSide.Long
        ? p.markPrice - p.entryPrice
        : p.entryPrice - p.markPrice
    const atr = pip / ta.d.atr
    if (
      (config.singleLossAtr < 0 && atr < config.singleLossAtr) ||
      (config.singleProfitAtr > 0 && atr > config.singleProfitAtr)
    ) {
      const _pip = orders
        .filter((o) => o.symbol === p.symbol && o.positionSide === p.positionSide)
        .map((o) =>
          o.positionSide === OrderPositionSide.Long
            ? p.markPrice - o.openPrice
            : o.openPrice - p.markPrice
        )
        .reduce((a, b) => a + b, 0)
      console.log('closeByATR', { symbol: p.symbol, pip: _pip })
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

  const id3 = setInterval(() => closeAll(), 5000)

  const id4 = setInterval(() => monitorPnL(), 2000)

  const id5 = setInterval(() => cancelTimedOutOrders(), 60000)

  gracefulShutdown([id1, id2, id3, id4, id5])
}

main()
