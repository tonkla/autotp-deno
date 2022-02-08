import { difference } from 'https://deno.land/std@0.95.0/datetime/mod.ts'
import { connect } from 'https://deno.land/x/redis/mod.ts'

import {
  OrderSide,
  OrderPositionSide,
  OrderType,
  OrderStatus,
  RedisKeys,
} from '../../consts/index.ts'
import { PostgreSQL } from '../../db/pg.ts'
import { Interval } from '../../exchange/binance/enums.ts'
import { getSymbolInfo } from '../../exchange/binance/futures.ts'
import { round } from '../../helper/number.ts'
import { calcStopLower, calcStopUpper } from '../../helper/price.ts'
import { Order, SymbolInfo, Ticker } from '../../types/index.ts'
import { getConfig } from './config.ts'
import { TaValues } from './types.ts'

const config = await getConfig()

const redis = await connect({
  hostname: '127.0.0.1',
  port: 6379,
})

const db = await new PostgreSQL().connect(config.dbUri)

const order: Order = {
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
  const price = openPrice
  return {
    ...order,
    id: Date.now().toString(),
    symbol,
    side,
    positionSide,
    openPrice: price,
    qty,
    type: OrderType.Limit,
  }
}

async function getMarkPrice(symbol: string): Promise<number> {
  const _ticker = await redis.get(RedisKeys.MarkPrice(config.exchange, symbol))
  if (!_ticker) return 0
  const ticker: Ticker = JSON.parse(_ticker)
  const diff = difference(new Date(ticker.time), new Date(), { units: ['seconds'] })
  if (diff?.seconds === undefined || diff.seconds > 5) {
    console.error(`Mark price is outdated ${diff?.seconds ?? -1} seconds.`)
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

async function processGainers() {
  const symbolInfos = await getSymbolInfos()
  const symbols: string[] = []
  const _gainers = await redis.get(RedisKeys.TopGainers(config.exchange))
  if (_gainers) {
    const gainers = JSON.parse(_gainers)
    if (Array.isArray(gainers)) symbols.push(...gainers)
  }

  // Create Limit Order (Open)
  for (const symbol of symbols) {
    const _ta = await redis.get(RedisKeys.TA(config.exchange, symbol, Interval.D1))
    if (!_ta) continue
    const ta: TaValues = JSON.parse(_ta)

    if (ta.atr === 0 || config.orderGapAtr === 0) return

    const info = getSymbolInfo(symbolInfos, symbol)
    if (!info) {
      console.error(`Info not found: ${symbol}`)
      continue
    }

    const markPrice = await getMarkPrice(symbol)
    if (markPrice === 0) continue

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
        exchange: config.exchange,
        symbol: symbol,
        botId: config.botId,
        side: OrderSide.Buy,
        positionSide: OrderPositionSide.Long,
        type: OrderType.Limit,
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

  // Create SL Order (Close)

  // Create TP Order (Close)
  // const tp = ta.atr * config.tpAtr
  // if (markPrice > ta.hma_0 + tp) {
  //   const price = markPrice
  //   const qty = round(config.quoteQty / price, info.qtyPrecision)
  //   const order =
  //   await redis.rpush(RedisKeys.Orders(config.exchange), JSON.stringify(order))
  // }
}

async function processLosers() {
  const symbolInfos = await getSymbolInfos()
  const symbols: string[] = []
  const _losers = await redis.get(RedisKeys.TopLosers(config.exchange))
  if (_losers) {
    const losers = JSON.parse(_losers)
    if (Array.isArray(losers)) symbols.push(...losers)
  }

  // Create Limit Order (Open)
  for (const symbol of symbols) {
    const _taValues = await redis.get(RedisKeys.TA(config.exchange, symbol, Interval.D1))
    if (!_taValues) continue
    const ta: TaValues = JSON.parse(_taValues)

    if (ta.atr === 0 || config.orderGapAtr === 0) return

    const info = getSymbolInfo(symbolInfos, symbol)
    if (!info) {
      console.error(`Info not found: ${symbol}`)
      continue
    }

    const markPrice = await getMarkPrice(symbol)
    if (markPrice === 0) continue

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
        exchange: config.exchange,
        symbol: symbol,
        botId: config.botId,
        side: OrderSide.Sell,
        positionSide: OrderPositionSide.Short,
        type: OrderType.Limit,
        openPrice: price,
      })
      if (norder && price - norder.openPrice < ta.atr * config.orderGapAtr) continue

      const qty = round(config.quoteQty / price, info.qtyPrecision)
      const order = buildLimitOrder(symbol, OrderSide.Sell, OrderPositionSide.Short, price, qty)
      await redis.rpush(RedisKeys.Orders(config.exchange), JSON.stringify(order))
    }
  }

  // Create SL Order (Close)

  // Create TP Order (Close)
  // const tp = ta.atr * config.tpAtr
  // if (markPrice < ta.lma_0 - tp) {
  //   const price = markPrice
  //   const qty = round(config.quoteQty / price, info.qtyPrecision)
  //   const order =
  //   await redis.rpush(RedisKeys.Orders(config.exchange), JSON.stringify(order))
  // }
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

  gracefulShutdown([id1, id2])
}

main()
