import { difference } from 'https://deno.land/std@0.135.0/datetime/mod.ts'
import { connect } from 'https://deno.land/x/redis@v0.25.4/mod.ts'

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
  TaValues_v2,
  TaValuesOHLC_v2,
} from '../../types/index.ts'
import { getConfig } from './config.ts'

const config = await getConfig()

const db = await new PostgreSQL().connect(config.dbUri)

const redis = await connect({ hostname: '127.0.0.1', port: 6379 })

const exchange = new PrivateApi(config.apiKey, config.secretKey)

const PC_HEADING = 15

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
  tad: TaValues_v2
  ta: TaValuesOHLC_v2
  info: SymbolInfo
  markPrice: number
}
async function prepare(symbol: string): Promise<Prepare | null> {
  const _tad = await redis.get(RedisKeys.TA(config.exchange, symbol, Interval.D1))
  if (!_tad) return null
  const tad: TaValues_v2 = JSON.parse(_tad)
  if (tad.atr === 0) return null

  const _ta = await redis.get(RedisKeys.TAOHLC(config.exchange, symbol, config.maTimeframe))
  if (!_ta) return null
  const ta: TaValuesOHLC_v2 = JSON.parse(_ta)
  if (ta.atr === 0) return null

  const info = await getSymbolInfo(redis, config.exchange, symbol)
  if (!info?.pricePrecision) return null

  const markPrice = await getMarkPrice(redis, config.exchange, symbol, 5)
  if (markPrice === 0) return null

  return { tad, ta, info, markPrice }
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
  const kv = await db.getKV(KV.LatestStop)
  if (kv?.v) return

  const _orders = await db.getOpenOrders(config.botId)
  const openSymbols = [...new Set(_orders.map((o) => o.symbol))]
  const symbols = await getSymbols()
  for (const symbol of symbols) {
    if (await redis.get(RedisKeys.Order(config.exchange))) return
    if (config.excluded.includes(symbol)) continue
    if (!openSymbols.includes(symbol) && openSymbols.length >= config.sizeActive) continue

    const p = await prepare(symbol)
    if (!p) continue
    const { tad, ta, info, markPrice } = p

    if (
      !(
        tad.hma_1 < tad.hma_0 &&
        tad.lma_1 < tad.lma_0 &&
        ta.c_0 < tad.hma_0 - tad.atr * 0.25 &&
        ta.hc < PC_HEADING
      )
    ) {
      continue
    }

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

    if (siblings.find((o) => Math.abs(o.openPrice - price) < tad.atr * config.orderGapAtr)) continue

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
  const symbols = await getSymbols()
  for (const symbol of symbols) {
    if (await redis.get(RedisKeys.Order(config.exchange))) return
    if (config.excluded.includes(symbol)) continue
    if (!openSymbols.includes(symbol) && openSymbols.length >= config.sizeActive) continue

    const p = await prepare(symbol)
    if (!p) continue
    const { tad, ta, info, markPrice } = p

    if (
      !(
        tad.hma_1 > tad.hma_0 &&
        tad.lma_1 > tad.lma_0 &&
        ta.c_0 > tad.lma_0 + tad.atr * 0.25 &&
        ta.cl < PC_HEADING
      )
    ) {
      continue
    }

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

    if (siblings.find((o) => Math.abs(o.openPrice - price) < tad.atr * config.orderGapAtr)) continue

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
      const pnl = orders
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
      console.log('CloseByUSD', { excUSD: p.unrealizedProfit, locUSD: round(pnl, 4) })
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

    const _tad = await redis.get(RedisKeys.TA(config.exchange, p.symbol, config.maTimeframe))
    if (!_tad) continue
    const tad: TaValues_v2 = JSON.parse(_tad)
    if (tad.atr === 0) continue

    const pip =
      p.positionSide === OrderPositionSide.Long
        ? p.markPrice - p.entryPrice
        : p.entryPrice - p.markPrice
    const atr = pip / tad.atr
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
      console.log('CloseByATR', { excPip: pip, locPip: _pip })
    }
  }
}

async function _closeAll() {
  const orders = await db.getOpenOrders(config.botId)
  await closeByUSD(orders)
  await closeByATR(orders)
}

async function monitorPnL() {
  let lpl = 0
  const longs = await db.getLongFilledOrders(qo)
  for (const o of longs) {
    const p = await prepare(o.symbol)
    if (!p) continue
    lpl += (p.markPrice - o.openPrice) * o.qty - o.commission * 2
  }
  // await redis.set(RedisKeys.PnL(config.exchange, config.botId, OrderPositionSide.Long), lpl)

  let spl = 0
  const shorts = await db.getShortFilledOrders(qo)
  for (const o of shorts) {
    const p = await prepare(o.symbol)
    if (!p) continue
    spl += (o.openPrice - p.markPrice) * o.qty - o.commission * 2
  }
  // await redis.set(RedisKeys.PnL(config.exchange, config.botId, OrderPositionSide.Short), spl)

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
    const { tad, ta } = p

    if (Math.abs(ta.c_0 - o.openPrice) < tad.atr * config.orderGapAtr * 2) continue

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
  const id1 = setInterval(() => createLongLimits(), 2000)

  const id2 = setInterval(() => createShortLimits(), 2000)

  // const id3 = setInterval(() => closeAll(), 5000)

  const id4 = setInterval(() => monitorPnL(), 2000)

  const id5 = setInterval(() => cancelTimedOutOrders(), 60000)

  gracefulShutdown([id1, id2, id4, id5])
}

main()
