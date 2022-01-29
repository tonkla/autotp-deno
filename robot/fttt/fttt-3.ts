import { connect } from 'https://deno.land/x/redis/mod.ts'

import { RedisKeys } from '../../consts/index.ts'

const config = {
  exchange: 'bn',
}

const redis = await connect({
  hostname: '127.0.0.1',
  port: 6379,
})

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
  const _order = await redis.lpop(RedisKeys.Orders(config.exchange))
  if (_order) {
    const order = JSON.parse(_order)
    console.log(order)
  }
  gracefulShutdown([])
}

main()
