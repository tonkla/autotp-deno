import { datetime, dotenv, redis as rd } from '../../deps.ts'

import { PostgreSQL } from '../../db/pgbf.ts'
import { PrivateApi } from '../../exchange/binance/futures.ts'
import { BotFunc } from '../../types/index.ts'
import { Config, getConfig } from './config.ts'

import { RedisKeys } from '../../db/redis.ts'
import FinderAB from './finder-ab.ts'
import FinderCD from './finder-cd.ts'

async function finder() {
  try {
    const env = dotenv.config()

    const bots: BotFunc[] = [FinderAB, FinderCD]

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

    const getSymbols = async (): Promise<string[]> => {
      try {
        const symbols = await redis.get(RedisKeys.SymbolsFutures(config.exchange))
        if (!symbols) return []
        return JSON.parse(symbols)
      } catch {
        return []
      }
    }

    const createOrders = async () => {
      try {
        const symbols = await getSymbols()
        // const bot = bots[new Date().getSeconds() % bots.length]
        for (const bot of bots) {
          const b = await bot({ symbols, db, redis, exchange })
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
        const symbols = await getSymbols()
        for (const bot of bots) {
          const b = await bot({ symbols, db, redis, exchange })
          b.cancelTimedOut()
        }
      } catch (e) {
        console.error(e)
      }
    }

    const _closeOrphanOrders = async () => {
      try {
        const symbols = await getSymbols()
        for (const bot of bots) {
          const b = await bot({ symbols, db, redis, exchange })
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
        Deno.exit()
      } catch (e) {
        console.error(e)
      }
    }

    const gracefulShutdown = (intervalIds: number[]) => {
      Deno.addSignalListener('SIGINT', () => clean(intervalIds))
      Deno.addSignalListener('SIGTERM', () => clean(intervalIds))
    }

    const id1 = setInterval(() => createOrders(), 2 * datetime.SECOND)

    const id2 = setInterval(() => cancelTimedOutOrders(), 20 * datetime.SECOND)

    // const id3 = setInterval(() => closeOrphanOrders(), datetime.MINUTE)

    gracefulShutdown([id1, id2])
  } catch (e) {
    console.error(e)
  }
}

finder()
