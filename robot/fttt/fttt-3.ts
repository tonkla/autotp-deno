import { connect } from 'https://deno.land/x/redis@v0.25.2/mod.ts'

import { PostgreSQL } from '../../db/pgbf.ts'
import { PrivateApi } from '../../exchange/binance/futures.ts'
import { RedisKeys } from '../../consts/index.ts'
import { Order } from '../../types/index.ts'
import { getConfig } from './config.ts'

const config = await getConfig()

const db = await new PostgreSQL().connect(config.dbUri)

const exchange = new PrivateApi(config.apiKey, config.secretKey)

const redis = await connect({
  hostname: '127.0.0.1',
  port: 6379,
})

async function trade() {
  const _order = await redis.lpop(RedisKeys.Orders(config.exchange))
  if (_order) {
    const order: Order = JSON.parse(_order)
    const newOrder = await exchange.openLimitOrder(order)
    if (newOrder) await db.createOrder(newOrder)
  }
}

function syncLimitOrders() {
  //
}

function syncSLOrders() {
  //
}

function syncTPOrders() {
  //
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
  trade()
  const id1 = setInterval(() => trade(), 2000)

  syncLimitOrders()
  const id2 = setInterval(() => syncLimitOrders(), 2000)

  syncSLOrders()
  const id3 = setInterval(() => syncSLOrders(), 2000)

  syncTPOrders()
  const id4 = setInterval(() => syncTPOrders(), 2000)

  gracefulShutdown([id1, id2, id3, id4])
}

main()
