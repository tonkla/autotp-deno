import { datetime, dotenv, redis as rd } from '../../deps.ts'

import { PostgreSQL } from '../../db/pgbf.ts'
import { PrivateApi } from '../../exchange/binance/futures.ts'
import { BotFunc } from '../../types/index.ts'
import { Config, getConfig } from './config.ts'

import Finder1 from './finder-1.ts'
import Finder2 from './finder-2.ts'

const env = dotenv.config()

const bots: BotFunc[] = [Finder1, Finder2]

const config: Config = await getConfig()

const db = await new PostgreSQL().connect('', {
  database: env.DB_NAME,
  hostname: env.DB_HOST,
  port: env.DB_PORT,
  user: env.DB_USER,
  password: env.DB_PASS,
  tls: { enabled: false },
})

const redis = await rd.connect({ hostname: '127.0.0.1', port: 6379 })

const exchange = new PrivateApi(config.apiKey, config.secretKey)

function createOrders() {
  for (const bot of bots) {
    const b = bot({ symbols: config.included, db, redis, exchange })
    b.createLongLimit()
    b.createShortLimit()
    b.createLongStop()
    b.createShortStop()
  }
}

function cancelTimedOutOrders() {
  for (const bot of bots) {
    const b = bot({ symbols: config.included, db, redis, exchange })
    b.cancelTimedOut()
  }
}

function closeOrphanOrders() {
  for (const bot of bots) {
    const b = bot({ symbols: config.included, db, redis, exchange })
    b.closeOrphan()
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

function finder() {
  const id1 = setInterval(() => createOrders(), 5 * datetime.SECOND)

  const id2 = setInterval(() => cancelTimedOutOrders(), 20 * datetime.SECOND)

  const id3 = setInterval(() => closeOrphanOrders(), datetime.MINUTE)

  gracefulShutdown([id1, id2, id3])
}

finder()
