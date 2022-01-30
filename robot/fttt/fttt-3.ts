import { connect } from 'https://deno.land/x/redis/mod.ts'

import { connect as connectSqlite } from '../../db/index.ts'
import { RedisKeys } from '../../consts/index.ts'
import { getConfig } from './config.ts'

const config = await getConfig()

const db = connectSqlite('autotp.db')

const redis = await connect({
  hostname: '127.0.0.1',
  port: 6379,
})

async function trade() {
  const _order = await redis.lpop(RedisKeys.Orders(config.exchange))
  if (_order) {
    const order = JSON.parse(_order)
    console.log(order)
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
