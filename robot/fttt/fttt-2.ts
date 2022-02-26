import { difference } from 'https://deno.land/std@0.126.0/datetime/mod.ts'
import { connect } from 'https://deno.land/x/redis@v0.25.2/mod.ts'

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

const exchange = new PrivateApi(config.apiKey, config.secretKey)

const logger = new Logger([Transports.Console, Transports.Telegram], {
  telegramBotToken: config.telegramBotToken,
  telegramChatId: config.telegramChatId,
})

async function placeOrder() {
  const _order = await redis.lpop(RedisKeys.Orders(config.exchange))
  if (!_order) return
  const _o: Order = JSON.parse(_order)
  if (_o.status === OrderStatus.Canceled) {
    const resp = await exchange.cancelOrder(_o.symbol, _o.id, _o.refId)
    if (
      resp?.status === OrderStatus.Canceled &&
      (await db.updateOrder({ ..._o, updateTime: resp.updateTime, closeTime: new Date() }))
    ) {
      await logger.info(Events.Cancel, _o)
    }
  } else {
    const order = await exchange.placeLimitOrder(_o)
    if (order && typeof order !== 'number') {
      if (await db.createOrder(order)) {
        await redis.del(RedisKeys.Failed(config.exchange, order.symbol, order.type))
        await logger.info(Events.Create, order)
      }
    } else if (order === Errors.OrderWouldImmediatelyTrigger) {
      const maxFailure = 3
      await retry(_o, maxFailure)
    } else {
      const exorders = await exchange.getTradesList(_o.symbol, 10)
      for (const exo of exorders) {
        if (exo.refId === _o.refId) {
          await db.updateOrder({ ..._o, closeTime: exo.updateTime ?? new Date() })
          break
        }
      }
      await redis.del(RedisKeys.Failed(config.exchange, _o.symbol, _o.type))
    }
    await redis.srem(RedisKeys.Waiting(config.exchange), _o.symbol)
  }
}

async function retry(o: Order, maxFailure: number) {
  let countFailed = 0
  const _count = await redis.get(RedisKeys.Failed(config.exchange, o.symbol, o.type))
  if (_count) {
    countFailed = toNumber(_count) + 1
    if (countFailed <= maxFailure) {
      await redis.set(RedisKeys.Failed(config.exchange, o.symbol, o.type), countFailed)
    }
  } else {
    countFailed = 1
    await redis.set(RedisKeys.Failed(config.exchange, o.symbol, o.type), 1)
  }

  if (countFailed > maxFailure) {
    const mo = await exchange.placeMarketOrder(o)
    if (mo) {
      await syncStatus(mo)
      if (([OrderType.FSL, OrderType.FTP] as string[]).includes(o.type)) {
        const sto = { ...mo, updateTime: new Date(), closeTime: new Date() }
        if (await db.createOrder(sto)) {
          const oo = await db.getOrder(sto.openOrderId ?? '')
          if (oo) {
            const pl =
              (oo.positionSide === OrderPositionSide.Long
                ? sto.openPrice - oo.openPrice
                : oo.openPrice - sto.openPrice) -
              sto.commission -
              oo.commission
            if (
              await db.updateOrder({
                ...oo,
                pl,
                closePrice: sto.openPrice,
                closeOrderId: sto.id,
                closeTime: new Date(),
              })
            ) {
              await logger.info(Events.Close, oo)
            }
          }
        }
      } else if (await db.createOrder(mo)) {
        await logger.info(Events.Create, mo)
      }
    }
    await redis.del(RedisKeys.Failed(config.exchange, o.symbol, o.type))
  } else {
    const markPrice = await getMarkPrice(redis, config.exchange, o.symbol)
    console.error('-------------------------------------------------------')
    console.error(
      JSON.stringify({
        count: countFailed,
        symbol: o.symbol,
        side: o.positionSide,
        type: o.type,
        price: o.openPrice,
        markPrice,
      })
    )
    console.error('-------------------------------------------------------')
  }
}

async function syncLongOrders() {
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
        const event = lo.type === OrderType.FSL ? Events.StopLoss : Events.TakeProfit
        await logger.info(event, lo)
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
    await db.updateOrder(lo)
  }
}

async function syncShortOrders() {
  const shortOrders = await db.getShortLimitNewOrders({})
  for (const so of shortOrders) {
    await syncStatus(so)
  }

  const slOrders = await db.getShortSLNewOrders({})
  const tpOrders = await db.getShortTPNewOrders({})
  for (const sto of [...slOrders, ...tpOrders]) {
    const isTraded = await syncStatus(sto)
    if (!isTraded) continue

    const info = await getSymbolInfo(redis, config.exchange, sto.symbol)
    if (!info) continue

    if (!sto.openOrderId) continue
    const oo = await db.getOrder(sto.openOrderId)
    if (!oo) {
      sto.closeTime = new Date()
      if (await db.updateOrder(sto)) {
        const event = sto.type === OrderType.FSL ? Events.StopLoss : Events.TakeProfit
        await logger.info(event, sto)
      }
      continue
    }

    oo.closeOrderId = sto.id
    oo.closePrice = sto.openPrice
    oo.closeTime = new Date()
    oo.pl = round(
      (oo.openPrice - oo.closePrice) * sto.qty - oo.commission - sto.commission,
      info.pricePrecision
    )
    if (await db.updateOrder(oo)) {
      await logger.info(Events.Close, oo)
    }

    sto.closeTime = oo.closeTime
    await db.updateOrder(sto)
  }
}

async function syncOrphanOrders() {
  const dborders = await db.getOpenOrders()
  for (const dbo of dborders) {
    const exorders = await exchange.getTradesList(dbo.symbol, 5)
    for (const exo of exorders) {
      if (exo.refId === dbo.refId) {
        await db.updateOrder({ ...dbo, closeTime: exo.updateTime ?? new Date() })
        break
      }
    }
  }
}

async function syncStatus(o: Order): Promise<boolean> {
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
  const exorders = await exchange.getTradesList(o.symbol, 5)
  for (const exo of exorders) {
    if (exo.refId === o.refId && o.commission === 0) {
      const comm = exo.commissionAsset === 'BNB' ? exo.commission * priceBNB : exo.commission
      o.commission = round(comm, 5)
      o.status = OrderStatus.Filled
      if (o.type !== OrderType.Limit) o.pl = exo.pl
      await db.updateOrder(o)
      return true
    }
  }
  return false
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
  await redis.del(RedisKeys.Waiting(config.exchange))

  placeOrder()
  const id1 = setInterval(() => placeOrder(), 3000)

  syncLongOrders()
  const id2 = setInterval(() => syncLongOrders(), 3000)

  syncShortOrders()
  const id3 = setInterval(() => syncShortOrders(), 3000)

  syncOrphanOrders()
  const id4 = setInterval(() => syncOrphanOrders(), 60000)

  gracefulShutdown([id1, id2, id3, id4])
}

main()
