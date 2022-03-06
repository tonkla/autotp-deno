import { connect } from 'https://deno.land/x/redis@v0.25.3/mod.ts'

import { PostgreSQL } from '../../db/pgbf.ts'
import { RedisKeys, getMarkPrice, getSymbolInfo } from '../../db/redis.ts'
import { Errors } from '../../exchange/binance/enums.ts'
import { PrivateApi } from '../../exchange/binance/futures.ts'
import { round, toNumber } from '../../helper/number.ts'
import { Logger, Events, Transports } from '../../service/logger.ts'
import { OrderPositionSide, OrderStatus, OrderType } from '../../consts/index.ts'
import { Order } from '../../types/index.ts'
import { getConfig } from './config.ts'

const config = await getConfig()

const db = await new PostgreSQL().connect(config.dbUri)

const redis = await connect({ hostname: '127.0.0.1', port: 6379 })

const exchange = new PrivateApi(config.apiKey, config.secretKey, redis)

const logger = new Logger([Transports.Console, Transports.Telegram], {
  telegramBotToken: config.telegramBotToken,
  telegramChatId: config.telegramChatId,
})

async function placeOrder() {
  const _o = await redis.lpop(RedisKeys.Orders(config.exchange))
  if (!_o) return
  const o: Order = JSON.parse(_o)
  if (o.status === OrderStatus.Canceled) {
    const res = await exchange.cancelOrder(o.symbol, o.id, o.refId)
    if (res && typeof res !== 'number') {
      if (res?.status === OrderStatus.Canceled) {
        if (await db.updateOrder({ ...o, updateTime: res.updateTime, closeTime: new Date() })) {
          await logger.info(Events.Cancel, o)
        }
      }
    } else {
      await logger.log(JSON.stringify({ error: res, symbol: o.symbol, id: o.id }))
    }
  } else {
    if (([OrderType.Limit, OrderType.FTP] as string[]).includes(o.type)) {
      const exo = await exchange.placeLimitOrder(o)
      if (exo && typeof exo !== 'number') {
        if (await db.createOrder(exo)) {
          await logger.info(Events.Create, exo)
          await redis.del(RedisKeys.Failed(config.exchange, o.botId, o.symbol, o.type))
        }
      } else if (exo !== Errors.OrderWouldImmediatelyTrigger) {
        await db.updateOrder({ ...o, closeTime: new Date() })
        await redis.del(RedisKeys.Failed(config.exchange, o.botId, o.symbol, o.type))

        await logger.log(JSON.stringify({ error: exo, symbol: o.symbol, id: o.id }))
        // const oo = await db.getOrder(o.openOrderId ?? '')
        // if (oo) await db.updateOrder({ ...oo, closeTime: new Date() })
      } else {
        const maxFailure = 5
        await retry(o, maxFailure)
      }
    } else if (o.type === OrderType.Market) {
      const exo = await exchange.placeMarketOrder(o)
      if (exo && typeof exo !== 'number') {
        exo.status = OrderStatus.Filled
        if (exo.openPrice === 0) {
          exo.openPrice = await getMarkPrice(redis, config.exchange, o.symbol)
        }
        if (exo.openOrderId) {
          exo.closeTime = exo.openTime
        }
        if (await db.createOrder(exo)) {
          await logger.info(Events.Create, exo)
          await closeOpenOrder(exo)
        }
      } else {
        await db.updateOrder({ ...o, closeTime: new Date() })

        await logger.log(JSON.stringify({ error: exo, symbol: o.symbol, id: o.id }))
        // const oo = await db.getOrder(o.openOrderId ?? '')
        // if (oo) await db.updateOrder({ ...oo, closeTime: new Date() })
      }
      await redis.del(RedisKeys.Failed(config.exchange, o.botId, o.symbol, o.type))
    }
    await redis.srem(RedisKeys.Waiting(config.exchange, o.botId), o.symbol)
  }
}

async function retry(o: Order, maxFailure: number) {
  let countFailure = 0
  const _count = await redis.get(RedisKeys.Failed(config.exchange, o.botId, o.symbol, o.type))
  if (_count) {
    countFailure = toNumber(_count) + 1
    if (countFailure <= maxFailure) {
      await redis.set(RedisKeys.Failed(config.exchange, o.botId, o.symbol, o.type), countFailure)
    }
  } else {
    countFailure = 1
    await redis.set(RedisKeys.Failed(config.exchange, o.botId, o.symbol, o.type), 1)
  }

  if (countFailure > maxFailure) {
    let sto = await exchange.placeMarketOrder(o)
    if (sto && typeof sto !== 'number') {
      await syncStatus(sto)

      if (o.type === OrderType.FTP) {
        sto = { ...sto, updateTime: sto.openTime, closeTime: sto.openTime }
        if (await db.createOrder(sto)) {
          await closeOpenOrder(sto)
        }
      } else if (await db.createOrder(sto)) {
        await logger.info(Events.Create, sto)
      }
    } else if (sto === Errors.ReduceOnlyOrderIsRejected) {
      await db.updateOrder({ ...o, closeTime: new Date() })
      const _oo = await db.getOrder(o.openOrderId ?? '')
      if (_oo) await db.updateOrder({ ..._oo, closeTime: new Date() })
    }
    await redis.del(RedisKeys.Failed(config.exchange, o.botId, o.symbol, o.type))
  }
}

async function closeOpenOrder(sto: Order) {
  let oo = await db.getOrder(sto.openOrderId ?? '')
  if (!oo) return

  if (sto.commission === 0) {
    const priceBNB = await getMarkPrice(redis, config.exchange, 'BNBUSDT')
    const exorders = await exchange.getTradesList(sto.symbol, 5)
    for (const exo of exorders) {
      if (exo.refId === sto.refId) {
        const comm = exo.commissionAsset === 'BNB' ? exo.commission * priceBNB : exo.commission
        sto.commission = round(comm, 5)
        if (exo.openPrice > 0) sto.openPrice = exo.openPrice
        sto.updateTime = exo.updateTime
        sto.status = OrderStatus.Filled
        await db.updateOrder(sto)
        break
      }
    }
  }

  const pl =
    (oo.positionSide === OrderPositionSide.Long
      ? sto.openPrice - oo.openPrice
      : oo.openPrice - sto.openPrice) *
      sto.qty -
    sto.commission -
    oo.commission
  oo = {
    ...oo,
    pl: sto.openPrice > 0 ? round(pl, 4) : 0,
    closePrice: sto.openPrice,
    closeTime: sto.closeTime ?? new Date(),
    closeOrderId: sto.id,
  }
  if (await db.updateOrder(oo)) {
    await logger.info(Events.Close, oo)
  }
}

async function syncLongOrders() {
  const longOrders = await db.getLongLimitNewOrders({})
  for (const lo of longOrders) {
    await syncStatus(lo)
  }

  const tpOrders = await db.getLongTPNewOrders({})
  for (const sto of tpOrders) {
    const isPlaced = await syncStatus(sto)
    if (!isPlaced) continue

    const info = await getSymbolInfo(redis, config.exchange, sto.symbol)
    if (!info) continue

    if (!sto.openOrderId) continue
    const oo = await db.getOrder(sto.openOrderId)
    if (!oo) {
      await db.updateOrder({ ...sto, closeTime: new Date() })
      continue
    }

    sto.closeTime = new Date()
    await db.updateOrder(sto)

    oo.closeOrderId = sto.id
    oo.closePrice = sto.openPrice
    oo.closeTime = sto.closeTime
    oo.pl = round((oo.closePrice - oo.openPrice) * sto.qty - oo.commission - sto.commission, 4)
    if (await db.updateOrder(oo)) {
      await logger.info(Events.Close, oo)
    }
  }
}

async function syncShortOrders() {
  const shortOrders = await db.getShortLimitNewOrders({})
  for (const so of shortOrders) {
    await syncStatus(so)
  }

  const tpOrders = await db.getShortTPNewOrders({})
  for (const sto of tpOrders) {
    const isPlaced = await syncStatus(sto)
    if (!isPlaced) continue

    const info = await getSymbolInfo(redis, config.exchange, sto.symbol)
    if (!info) continue

    if (!sto.openOrderId) continue
    const oo = await db.getOrder(sto.openOrderId)
    if (!oo) {
      await db.updateOrder({ ...sto, closeTime: new Date() })
      continue
    }

    sto.closeTime = new Date()
    await db.updateOrder(sto)

    oo.closeOrderId = sto.id
    oo.closePrice = sto.openPrice
    oo.closeTime = sto.closeTime
    oo.pl = round((oo.openPrice - oo.closePrice) * sto.qty - oo.commission - sto.commission, 4)
    if (await db.updateOrder(oo)) {
      await logger.info(Events.Close, oo)
    }
  }
}

async function syncStatus(o: Order): Promise<boolean> {
  const exo = await exchange.getOrder(o.symbol, o.id, o.refId)
  if (!exo) return false

  if (exo.status !== o.status) {
    o.status = exo.status
    o.updateTime = exo.updateTime

    const canceled: string[] = [OrderStatus.Canceled, OrderStatus.Expired, OrderStatus.Rejected]
    if (canceled.includes(exo.status)) {
      o.closeTime = new Date()
    }
    if (await db.updateOrder(o)) {
      await logger.info(Events.Update, o)
    }
  }

  const priceBNB = await getMarkPrice(redis, config.exchange, 'BNBUSDT')
  const exorders = await exchange.getTradesList(o.symbol, 5)
  for (const exo of exorders) {
    if (exo.refId === o.refId && o.commission === 0) {
      const comm = exo.commissionAsset === 'BNB' ? exo.commission * priceBNB : exo.commission
      o.commission = round(comm, 5)
      o.updateTime = exo.updateTime
      o.status = OrderStatus.Filled
      if (exo.openPrice > 0) o.openPrice = exo.openPrice
      if (o.type === OrderType.FTP) o.pl = round(exo.pl, 4)
      await db.updateOrder(o)
      return true
    }
  }
  return false
}

async function countRequests() {
  const count = await redis.get(RedisKeys.Request(config.exchange))
  console.info('\n', `Requests/Minute: ${count}`)
  await redis.set(RedisKeys.Request(config.exchange), 0)
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

async function main() {
  await redis.del(RedisKeys.Orders(config.exchange))

  placeOrder()
  const id1 = setInterval(() => placeOrder(), 2000)

  syncLongOrders()
  const id2 = setInterval(() => syncLongOrders(), 3000)

  syncShortOrders()
  const id3 = setInterval(() => syncShortOrders(), 3000)

  const id4 = setInterval(() => db.deleteCanceledOrders(), 600000) // 10m

  countRequests()
  const id5 = setInterval(() => countRequests(), 60000)

  gracefulShutdown([id1, id2, id3, id4, id5])
}

main()
