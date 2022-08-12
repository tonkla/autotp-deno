import { datetime, dotenv, redis as rd } from '../../deps.ts'

import { PostgreSQL } from '../../db/pgbf.ts'
import { PrivateApi } from '../../exchange/binance/futures.ts'
import { BotFunc } from '../../types/index.ts'
import { Config, getConfig } from './config.ts'

import FinderC from './finder-c.ts'

async function finder() {
  try {
    const env = dotenv.config()

    const bots: BotFunc[] = [FinderC]

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

    const createOrders = async () => {
      try {
        for (const bot of bots) {
          const b = await bot({ symbols: config.included, db, redis, exchange })
          b.createLongLimit()
          b.createShortLimit()
          b.createLongStop()
          b.createShortStop()
        }
      } catch (e) {
        console.error(e)
      }
    }

    const cancelTimedOutOrders = async () => {
      try {
        for (const bot of bots) {
          const b = await bot({ symbols: config.included, db, redis, exchange })
          b.cancelTimedOut()
        }
      } catch (e) {
        console.error(e)
      }
    }

    const closeOrphanOrders = async () => {
      try {
        for (const bot of bots) {
          const b = await bot({ symbols: config.included, db, redis, exchange })
          b.closeOrphan()
        }
      } catch (e) {
        console.error(e)
      }
    }

    const clean = (intervalIds: number[]) => {
      try {
        for (const id of intervalIds) {
          clearInterval(id)
        }
        db.close()
      } catch (e) {
        console.error(e)
      }
    }

    const gracefulShutdown = (intervalIds: number[]) => {
      Deno.addSignalListener('SIGINT', () => clean(intervalIds))
      Deno.addSignalListener('SIGTERM', () => clean(intervalIds))
    }

    const id1 = setInterval(() => createOrders(), 5 * datetime.SECOND)

    const id2 = setInterval(() => cancelTimedOutOrders(), 20 * datetime.SECOND)

    const id3 = setInterval(() => closeOrphanOrders(), datetime.MINUTE)

    gracefulShutdown([id1, id2, id3])
  } catch (e) {
    console.error(e)
  }
}

finder()
