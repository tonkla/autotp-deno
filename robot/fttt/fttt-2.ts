import { difference } from 'https://deno.land/std@0.95.0/datetime/mod.ts'
import { connect } from 'https://deno.land/x/redis@v0.25.2/mod.ts'

import {
  OrderSide,
  OrderPositionSide,
  OrderType,
  OrderStatus,
  RedisKeys,
} from '../../consts/index.ts'
import { PostgreSQL } from '../../db/pgbf.ts'
import { Interval } from '../../exchange/binance/enums.ts'
import { getSymbolInfo } from '../../exchange/binance/futures.ts'
import { round } from '../../helper/number.ts'
import { calcStopLower, calcStopUpper } from '../../helper/price.ts'
import { Order, QueryOrder, SymbolInfo, Ticker } from '../../types/index.ts'
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
  id: '',
  refId: '',
  exchange: config.exchange,
  symbol: '',
  botId: config.botId,
  side: '',
  positionSide: '',
  type: '',
  status: OrderStatus.New,
  qty: 0,
  zonePrice: 0,
  openPrice: 0,
  closePrice: 0,
  commission: 0,
  pl: 0,
  openOrderId: '',
  closeOrderId: '',
  openTime: 0,
  closeTime: 0,
  updateTime: 0,
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
  qty: number
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

async function getSymbolInfos(): Promise<SymbolInfo[]> {
  const _infos = await redis.get(RedisKeys.Symbols(config.exchange))
  if (!_infos) return []
  const symbolInfos: SymbolInfo[] = JSON.parse(_infos).map((s: (string | number)[]) => ({
    symbol: s[0],
    pricePrecision: s[1],
    qtyPrecision: s[2],
  }))
  return symbolInfos
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

  const symbolInfos = await getSymbolInfos()
  const info = getSymbolInfo(symbolInfos, symbol)
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

async function processGainers() {
  const symbols: string[] = []
  const _gainers = await redis.get(RedisKeys.TopGainers(config.exchange))
  if (_gainers) {
    const gainers = JSON.parse(_gainers)
    if (Array.isArray(gainers)) symbols.push(...gainers)
  }
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

      const qty = round(config.quoteQty / price, info.qtyPrecision)
      const order = buildLimitOrder(symbol, OrderSide.Buy, OrderPositionSide.Long, price, qty)
      await redis.rpush(RedisKeys.Orders(config.exchange), JSON.stringify(order))
    }
  }
}

async function processLosers() {
  const symbols: string[] = []
  const _losers = await redis.get(RedisKeys.TopLosers(config.exchange))
  if (_losers) {
    const losers = JSON.parse(_losers)
    if (Array.isArray(losers)) symbols.push(...losers)
  }
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

      const qty = round(config.quoteQty / price, info.qtyPrecision)
      const order = buildLimitOrder(symbol, OrderSide.Sell, OrderPositionSide.Short, price, qty)
      await redis.rpush(RedisKeys.Orders(config.exchange), JSON.stringify(order))
    }
  }
}

async function processLongs() {
  const orders = await db.getLongLimitFilledOrders(qo)
  for (const o of orders) {
    const p = await prepare(o.symbol)
    if (!p) continue
    const { ta, info, markPrice } = p

    const tp = ta.atr * config.tpAtr
    if (markPrice > ta.hma_0 + tp) {
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
        o.qty
      )
      await redis.rpush(RedisKeys.Orders(config.exchange), JSON.stringify(order))
    }
  }
}

async function processShorts() {
  const orders = await db.getShortLimitFilledOrders(qo)
  for (const o of orders) {
    const p = await prepare(o.symbol)
    if (!p) continue
    const { ta, info, markPrice } = p

    const tp = ta.atr * config.tpAtr
    if (markPrice < ta.lma_0 - tp) {
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
        o.qty
      )
      await redis.rpush(RedisKeys.Orders(config.exchange), JSON.stringify(order))
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
  processGainers()
  const id1 = setInterval(() => processGainers(), 2000)

  processLosers()
  const id2 = setInterval(() => processLosers(), 2000)

  processLongs()
  const id3 = setInterval(() => processLongs(), 2000)

  processShorts()
  const id4 = setInterval(() => processShorts(), 2000)

  gracefulShutdown([id1, id2, id3, id4])
}

main()
