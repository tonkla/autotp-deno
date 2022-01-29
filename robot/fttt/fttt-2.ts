import { parse } from 'https://deno.land/std@0.122.0/encoding/toml.ts'
import { connect } from 'https://deno.land/x/redis/mod.ts'

import {
  OrderSide,
  OrderPositionSide,
  OrderType,
  OrderStatus,
  RedisKeys,
} from '../../consts/index.ts'
import { Interval } from '../../exchange/binance/enums.ts'
import { getSymbolInfo } from '../../exchange/binance/futures.ts'
import { round } from '../../helper/number.ts'
import { Order } from '../../types/index.ts'
import { TaValues } from './types.ts'

interface Config {
  apiKey: string
  secretKey: string
  exchange: string
  botId: number
  quoteQty: number
}

const redis = await connect({
  hostname: '127.0.0.1',
  port: 6379,
})

function buildLimitOrder(
  config: Config,
  symbol: string,
  positionSide: string,
  price: number,
  qty: number
): Order {
  return {
    id: Date.now().toString(),
    refId: '',
    exchange: config.exchange,
    symbol,
    botId: config.botId,
    side: OrderSide.Buy,
    positionSide,
    type: OrderType.Limit,
    status: OrderStatus.New,
    qty,
    zonePrice: 0,
    openPrice: price,
    closePrice: 0,
    commission: 0,
    pl: 0,
    openOrderId: '',
    closeOrderId: '',
    openTime: 0,
    closeTime: 0,
    updateTime: 0,
  }
}

async function processGainers(config: Config) {
  const symbols: string[] = []
  const _gainers = await redis.get(RedisKeys.TopGainers(config.exchange))
  if (_gainers) {
    const gainers = JSON.parse(_gainers)
    if (Array.isArray(gainers)) symbols.push(...gainers)
  }
  for (const symbol of symbols) {
    const _ta = await redis.get(RedisKeys.TA(config.exchange, symbol, Interval.D1))
    if (!_ta) continue
    const ta: TaValues = JSON.parse(_ta)
    if (
      ta.hma_1 < ta.hma_0 &&
      ta.lma_1 < ta.lma_0 &&
      ta.hma_0 - ta.cma_0 < ta.cma_0 - ta.lma_0 &&
      ta.c_0 < ta.c_1 &&
      ta.c_0 > ta.l_2
    ) {
      const info = await getSymbolInfo(symbol)
      if (!info) continue
      const _price = 0
      const _qty = config.quoteQty / _price
      const price = round(_price, info.pricePrecision)
      const qty = round(_qty, info.qtyPrecision)
      const order = buildLimitOrder(config, symbol, OrderPositionSide.Long, price, qty)
      await redis.rpush(RedisKeys.Orders(config.exchange), JSON.stringify(order))
    }
  }
}

async function processLosers(config: Config) {
  const symbols: string[] = []
  const _losers = await redis.get(RedisKeys.TopLosers(config.exchange))
  if (_losers) {
    const losers = JSON.parse(_losers)
    if (Array.isArray(losers)) symbols.push(...losers)
  }
  for (const symbol of symbols) {
    const _taValues = await redis.get(RedisKeys.TA(config.exchange, symbol, Interval.D1))
    if (!_taValues) continue
    const ta: TaValues = JSON.parse(_taValues)
    if (
      ta.hma_1 > ta.hma_0 &&
      ta.lma_1 > ta.lma_0 &&
      ta.hma_0 - ta.cma_0 > ta.cma_0 - ta.lma_0 &&
      ta.c_0 > ta.c_1 &&
      ta.c_0 < ta.h_2
    ) {
      const info = await getSymbolInfo(symbol)
      if (!info) continue
      const _price = 0
      const _qty = config.quoteQty / _price
      const price = round(_price, info.pricePrecision)
      const qty = round(_qty, info.qtyPrecision)
      const order = buildLimitOrder(config, symbol, OrderPositionSide.Short, price, qty)
      await redis.rpush(RedisKeys.Orders(config.exchange), JSON.stringify(order))
    }
  }
}

function clean(intervalIds: number[]) {
  for (const id of intervalIds) {
    clearInterval(id)
  }
  redis.close()
}

function gracefulShutdown(intervalIds: number[]) {
  Deno.addSignalListener('SIGINT', () => clean(intervalIds))
  Deno.addSignalListener('SIGTERM', () => clean(intervalIds))
}

async function main() {
  if (Deno.args.length === 0) {
    console.info('Please specify a TOML configuration file.')
    gracefulShutdown([])
    Deno.exit()
  }

  const toml = await Deno.readTextFile(Deno.args[0])
  const c = parse(toml)
  const config: Config = {
    apiKey: c.apiKey as string,
    secretKey: c.secret as string,
    exchange: c.exchange as string,
    botId: c.botId as number,
    quoteQty: c.quoteQty as number,
  }

  await processGainers(config)
  const id1 = setInterval(async () => await processGainers(config), 2000)

  await processLosers(config)
  const id2 = setInterval(async () => await processLosers(config), 2000)

  gracefulShutdown([id1, id2])
}

main()
