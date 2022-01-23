import { parse } from 'https://deno.land/std@0.122.0/encoding/toml.ts'
import { connect } from 'https://deno.land/x/redis/mod.ts'

import { RedisKeys } from '../../consts/index.ts'
import { Interval } from '../../exchange/binance/enums.ts'
import { openLimitOrder } from '../../exchange/binance/futures.ts'
import { OrderSide, OrderPositionSide, OrderType, OrderStatus } from '../../consts/index.ts'
import { Order } from '../../types/index.ts'
import { TaValues } from './types.ts'

interface Config {
  apiKey: string
  secretKey: string
  exchange: string
  botId: number
}

const redis = await connect({
  hostname: '127.0.0.1',
  port: 6379,
})

function buildNewOrder(config: Config, symbol: string, positionSide: string): Order {
  return {
    id: '',
    refId: '',
    exchange: config.exchange,
    symbol,
    botId: config.botId,
    side: OrderSide.Buy,
    positionSide,
    type: OrderType.Limit,
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
      const order = buildNewOrder(config, symbol, OrderPositionSide.Long)
      await openLimitOrder(order, config.secretKey)
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
      const order = buildNewOrder(config, symbol, OrderPositionSide.Short)
      await openLimitOrder(order, config.secretKey)
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
    console.info('Please specify a configuration file.')
    gracefulShutdown([])
    Deno.exit()
  }

  const toml = await Deno.readTextFile(Deno.args[0])
  const config = parse(toml)

  // await processGainers(config)
  // await processLosers(config)

  gracefulShutdown([])
}

main()
