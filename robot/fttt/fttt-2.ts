import { difference } from 'https://deno.land/std@0.126.0/datetime/mod.ts'
import { connect } from 'https://deno.land/x/redis@v0.25.2/mod.ts'

import { PostgreSQL } from '../../db/pgbf.ts'
import { getMarkPrice, getSymbolInfo } from '../../db/redis.ts'
import { PrivateApi } from '../../exchange/binance/futures.ts'
import { round } from '../../helper/number.ts'
import { Logger, Events, Transports } from '../../service/logger.ts'
import { RedisKeys, OrderStatus, OrderType } from '../../consts/index.ts'
import { Order } from '../../types/index.ts'
import { getConfig } from './config.ts'

const config = await getConfig()

const db = await new PostgreSQL().connect(config.dbUri)

const redis = await connect({ hostname: '127.0.0.1', port: 6379 })

const exchange = new PrivateApi(config.apiKey, config.secretKey)

async function placeOrder() {
  const logger = new Logger([Transports.Console, Transports.Telegram], {
    telegramBotToken: config.telegramBotToken,
    telegramChatId: config.telegramChatId,
  })

  const _order = await redis.lpop(RedisKeys.Orders(config.exchange))
  if (_order) {
    const __order: Order = JSON.parse(_order)
    const order = await exchange.placeOrder(__order)
    if (order && (await db.createOrder(order))) {
      await logger.info(Events.Create, order)
    }
    await redis.srem(RedisKeys.Waiting(config.exchange), __order.symbol)
  }
}

async function syncLongOrders() {
  const logger = new Logger([Transports.Console, Transports.Telegram], {
    telegramBotToken: config.telegramBotToken,
    telegramChatId: config.telegramChatId,
  })

  const longOrders = await db.getLongLimitNewOrders({})
  for (const lo of longOrders) {
    await syncStatus(lo)
  }

  const slOrders = await db.getLongSLNewOrders({})
  const tpOrders = await db.getLongTPNewOrders({})
  for (const lo of [...slOrders, ...tpOrders]) {
    const isTraded = await syncStatus(lo)
    if (!isTraded) continue

    const info = await getSymbolInfo(redis, config.exchange, lo.symbol)
    if (!info) continue

    if (!lo.openOrderId) continue
    const oo = await db.getOrder(lo.openOrderId)
    if (!oo) {
      lo.closeTime = new Date()
      if (await db.updateOrder(lo)) {
        await logger.info(Events.Close, lo)
      }
      continue
    }

    oo.closeOrderId = lo.id
    oo.closePrice = lo.openPrice
    oo.closeTime = new Date()
    oo.pl = round(
      (oo.closePrice - oo.openPrice) * lo.qty - oo.commission - lo.commission,
      info.pricePrecision
    )
    if (await db.updateOrder(oo)) {
      await logger.info(Events.Close, oo)
    }

    lo.closeTime = oo.closeTime
    if (await db.updateOrder(lo)) {
      await logger.info(Events.Close, lo)
    }
  }
}

async function syncShortOrders() {
  const logger = new Logger([Transports.Console, Transports.Telegram], {
    telegramBotToken: config.telegramBotToken,
    telegramChatId: config.telegramChatId,
  })

  const shortOrders = await db.getShortLimitNewOrders({})
  for (const so of shortOrders) {
    await syncStatus(so)
  }

  const slOrders = await db.getShortSLNewOrders({})
  const tpOrders = await db.getShortTPNewOrders({})
  for (const so of [...slOrders, ...tpOrders]) {
    const isTraded = await syncStatus(so)
    if (!isTraded) continue

    const info = await getSymbolInfo(redis, config.exchange, so.symbol)
    if (!info) continue

    if (!so.openOrderId) continue
    const oo = await db.getOrder(so.openOrderId)
    if (!oo) {
      so.closeTime = new Date()
      if (await db.updateOrder(so)) {
        await logger.info(Events.Close, so)
      }
      continue
    }

    oo.closeOrderId = so.id
    oo.closePrice = so.openPrice
    oo.closeTime = new Date()
    oo.pl = round(
      (oo.openPrice - oo.closePrice) * so.qty - oo.commission - so.commission,
      info.pricePrecision
    )
    if (await db.updateOrder(oo)) {
      await logger.info(Events.Close, oo)
    }

    so.closeTime = oo.closeTime
    if (await db.updateOrder(so)) {
      await logger.info(Events.Close, so)
    }
  }
}

async function syncStatus(o: Order): Promise<boolean> {
  const logger = new Logger([Transports.Console, Transports.Telegram], {
    telegramBotToken: config.telegramBotToken,
    telegramChatId: config.telegramChatId,
  })

  const exo = await exchange.getOrder(o.symbol, o.id, o.refId)
  if (!exo) return false

  if (exo.status === OrderStatus.New) {
    if (config.timeSecCancel <= 0 || !o.openTime) return false

    const diff = difference(o.openTime, new Date(), { units: ['seconds'] })
    if ((diff?.seconds ?? 0) < config.timeSecCancel) return false

    const res = await exchange.cancelOrder(o.symbol, o.id, o.refId)
    if (!res) return false

    o.status = res.status
    o.updateTime = res.updateTime
    o.closeTime = new Date()
    if (await db.updateOrder(o)) {
      await logger.info(Events.Cancel, o)
    }

    return false
  }

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
  const orders = await exchange.getTradesList(o.symbol, 5)
  for (const to of orders) {
    if (to.refId === o.refId && !o.closeTime && o.status === OrderStatus.Filled) {
      const comm = to.commissionAsset === 'BNB' ? to.commission * priceBNB : to.commission
      o.commission = round(comm, 5)
      if (o.type !== OrderType.Limit) o.pl = to.pl
      await db.updateOrder(o)
      return true
    }
  }
  return false
}

async function log() {
  const logger = new Logger([Transports.Console, Transports.Telegram], {
    telegramBotToken: config.telegramBotToken,
    telegramChatId: config.telegramChatId,
  })
  await logger.info(Events.Log, 'FTTT-2 is working...')
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
  log()
  const id0 = setInterval(() => log(), 3600000) // 1h

  placeOrder()
  const id1 = setInterval(() => placeOrder(), 2000)

  syncLongOrders()
  const id2 = setInterval(() => syncLongOrders(), 3000)

  syncShortOrders()
  const id3 = setInterval(() => syncShortOrders(), 3000)

  gracefulShutdown([id0, id1, id2, id3])
}

main()
