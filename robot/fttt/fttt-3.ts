import { difference } from 'https://deno.land/std@0.125.0/datetime/mod.ts'
import { connect } from 'https://deno.land/x/redis@v0.25.2/mod.ts'

import { OrderSide, OrderPositionSide, OrderType, RedisKeys } from '../../consts/index.ts'
import { PostgreSQL } from '../../db/pgbf.ts'
import { getSymbolInfo } from '../../db/redis.ts'
import { Interval } from '../../exchange/binance/enums.ts'
import { round } from '../../helper/number.ts'
import { calcStopLower, calcStopUpper } from '../../helper/price.ts'
import { Order, QueryOrder, Ticker } from '../../types/index.ts'
import { getConfig } from './config.ts'
import { TaValues } from './types.ts'

const config = await getConfig()

const redis = await connect({
  hostname: '127.0.0.1',
  port: 6379,
})

const db = await new PostgreSQL().connect(config.dbUri)

const qo: QueryOrder = {
  exchange: config.exchange,
  botId: config.botId,
}

const newOrder: Order = {
  exchange: '',
  botId: '',
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

async function getMarkPrice(symbol: string): Promise<number> {
  const _ticker = await redis.get(RedisKeys.MarkPrice(config.exchange, symbol))
  if (!_ticker) return 0
  const ticker: Ticker = JSON.parse(_ticker)
  const diff = difference(new Date(ticker.time), new Date(), { units: ['seconds'] })
  if (diff?.seconds === undefined || diff.seconds > 5) {
    console.error(`Mark price of ${symbol} is outdated ${diff?.seconds ?? -1} seconds.`)
    return 0
  }
  return ticker.price
}

async function prepare(symbol: string) {
  const _ta = await redis.get(RedisKeys.TA(config.exchange, symbol, Interval.D1))
  if (!_ta) {
    console.error(`TA not found: ${symbol}`)
    return null
  }
  const ta: TaValues = JSON.parse(_ta)

  if (ta.atr === 0 || config.orderGapAtr === 0) {
    console.error(`ATR not found: ${symbol}`)
    return null
  }

  const info = await getSymbolInfo(redis, config.exchange, symbol)
  if (!info?.pricePrecision) {
    console.error(`Info not found: ${symbol}`)
    return null
  }

  const markPrice = await getMarkPrice(symbol)
  if (markPrice === 0) {
    console.error(`Mark Price is zero: ${symbol}`)
    return null
  }

  return { ta, info, markPrice }
}

async function getSymbols(): Promise<string[]> {
  const tradingSymbols = await db.getTradingSymbols()
  const symbols: string[] = ['BNBUSDT', ...tradingSymbols]

  const _gainers = await redis.get(RedisKeys.TopGainers(config.exchange))
  if (_gainers) {
    const gainers = JSON.parse(_gainers)
    if (Array.isArray(gainers)) symbols.push(...gainers)
  }

  const _losers = await redis.get(RedisKeys.TopLosers(config.exchange))
  if (_losers) {
    const losers = JSON.parse(_losers)
    if (Array.isArray(losers)) symbols.push(...losers)
  }

  return [...new Set(symbols)]
}

async function createLongLimits() {
  const symbols = await getSymbols()
  for (const symbol of symbols) {
    const p = await prepare(symbol)
    if (!p) continue
    const { ta, info, markPrice } = p

    if (
      ta.hma_1 < ta.hma_0 &&
      ta.lma_1 < ta.lma_0 &&
      ta.hma_0 - ta.cma_0 < ta.cma_0 - ta.lma_0 &&
      ta.c_0 < ta.c_1 &&
      ta.c_0 > ta.l_2
    ) {
      const price = calcStopLower(markPrice, config.openLimit, info.pricePrecision)
      if (price <= 0) continue

      const norder = await db.getNearestOrder({
        symbol,
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
      console.info('LONG', JSON.stringify(order))
    }
  }
}

async function createShortLimits() {
  const symbols = await getSymbols()
  for (const symbol of symbols) {
    const p = await prepare(symbol)
    if (!p) continue
    const { ta, info, markPrice } = p

    if (
      ta.hma_1 > ta.hma_0 &&
      ta.lma_1 > ta.lma_0 &&
      ta.hma_0 - ta.cma_0 > ta.cma_0 - ta.lma_0 &&
      ta.c_0 > ta.c_1 &&
      ta.c_0 < ta.h_2
    ) {
      const price = calcStopUpper(markPrice, config.openLimit, info.pricePrecision)
      if (price <= 0) continue

      const norder = await db.getNearestOrder({
        symbol,
        positionSide: OrderPositionSide.Short,
        openPrice: price,
      })
      if (norder && price - norder.openPrice < ta.atr * config.orderGapAtr) continue

      const qty = round((config.quoteQty / price) * config.leverage, info.qtyPrecision)
      const order = buildLimitOrder(symbol, OrderSide.Sell, OrderPositionSide.Short, price, qty)
      await redis.rpush(RedisKeys.Orders(config.exchange), JSON.stringify(order))
      console.info('SHORT', JSON.stringify(order))
    }
  }
}

async function createLongStops() {
  const orders = await db.getLongLimitFilledOrders(qo)
  for (const o of orders) {
    const p = await prepare(o.symbol)
    if (!p) continue
    const { ta, info, markPrice } = p

    const sl = ta.atr * config.slAtr
    if (sl > 0 && o.openPrice - markPrice > sl && !(await db.getStopOrder(o.id, OrderType.FSL))) {
      const stopPrice = calcStopUpper(markPrice, config.slStop, info.pricePrecision)
      const slPrice = calcStopUpper(markPrice, config.slLimit, info.pricePrecision)
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
      await redis.rpush(RedisKeys.Orders(config.exchange), JSON.stringify(order))
      console.info('LONG-SL', order)
    }

    const tp = ta.atr * config.tpAtr
    if (tp > 0 && markPrice - o.openPrice > tp && !(await db.getStopOrder(o.id, OrderType.FTP))) {
      const stopPrice = calcStopUpper(markPrice, config.tpStop, info.pricePrecision)
      const tpPrice = calcStopUpper(markPrice, config.tpLimit, info.pricePrecision)
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
      console.info('LONG-TP', order)
    }
  }
}

async function createShortStops() {
  const orders = await db.getShortLimitFilledOrders(qo)
  for (const o of orders) {
    const p = await prepare(o.symbol)
    if (!p) continue
    const { ta, info, markPrice } = p

    const sl = ta.atr * config.slAtr
    if (sl > 0 && markPrice - o.openPrice > sl && !(await db.getStopOrder(o.id, OrderType.FSL))) {
      const stopPrice = calcStopLower(markPrice, config.slStop, info.pricePrecision)
      const slPrice = calcStopLower(markPrice, config.slLimit, info.pricePrecision)
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
      await redis.rpush(RedisKeys.Orders(config.exchange), JSON.stringify(order))
      console.info('SHORT-SL', order)
    }

    const tp = ta.atr * config.tpAtr
    if (tp > 0 && o.openPrice - markPrice > tp && !(await db.getStopOrder(o.id, OrderType.FTP))) {
      const stopPrice = calcStopLower(markPrice, config.tpStop, info.pricePrecision)
      const tpPrice = calcStopLower(markPrice, config.tpLimit, info.pricePrecision)
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
      console.info('SHORT-TP', order)
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

function main() {
  console.info('\nFTTT-3 Started\n')

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
