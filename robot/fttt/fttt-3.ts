import { connect } from 'https://deno.land/x/redis/mod.ts'

import { PostgreSQL } from '../../db/pg.ts'
import { PrivateApi } from '../../exchange/binance/futures.ts'
import { RedisKeys } from '../../consts/index.ts'
import { Order } from '../../types/index.ts'
import { getConfig } from './config.ts'

const config = await getConfig()

const db = await new PostgreSQL().connect('')

const exchange = new PrivateApi(config.apiKey, config.secretKey)

const redis = await connect({
  hostname: '127.0.0.1',
  port: 6379,
})

async function trade() {
  const _order = await redis.lpop(RedisKeys.Orders(config.exchange))
  if (_order) {
    const order: Order = JSON.parse(_order)
    const exorder = await exchange.openLimitOrder(order)
    if (exorder) {
      await db.createOrder(exorder)
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
  trade()
  const id1 = setInterval(() => trade(), 2000)

  gracefulShutdown([id1])
}

main()
