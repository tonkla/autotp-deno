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
    if (_o.type === OrderType.Limit || _o.type === OrderType.FTP) {
      const order = await exchange.placeLimitOrder(_o)
      if (order && typeof order !== 'number') {
        if (await db.createOrder(order)) {
          await redis.del(RedisKeys.Failed(config.exchange, order.symbol, order.type))
          await logger.info(Events.Create, order)
        }
      } else if (order !== Errors.OrderWouldImmediatelyTrigger) {
        await db.updateOrder({ ..._o, closeTime: new Date() })
        const _oo = await db.getOrder(_o.openOrderId ?? '')
        if (_oo) await db.updateOrder({ ..._oo, closeTime: new Date() })
        await redis.del(RedisKeys.Failed(config.exchange, _o.symbol, _o.type))
      } else {
        const maxFailure = 3
        await retry(_o, maxFailure)
      }
    } else if (_o.type === OrderType.Market) {
      const sto = await exchange.placeMarketOrder(_o)
      if (sto && typeof sto !== 'number') {
        if (await db.createOrder(sto)) {
          await closeOpenOrder(sto)
          await redis.del(RedisKeys.Failed(config.exchange, sto.symbol, sto.type))
          await logger.info(Events.Create, sto)
        }
      } else {
        await db.updateOrder({ ..._o, closeTime: new Date() })
        const _oo = await db.getOrder(_o.openOrderId ?? '')
        if (_oo) await db.updateOrder({ ..._oo, closeTime: new Date() })
        await redis.del(RedisKeys.Failed(config.exchange, _o.symbol, _o.type))
      }
    }

    await redis.srem(RedisKeys.Waiting(config.exchange), _o.symbol)
  }
}

async function retry(o: Order, maxFailure: number) {
  let countFailure = 0
  const _count = await redis.get(RedisKeys.Failed(config.exchange, o.symbol, o.type))
  if (_count) {
    countFailure = toNumber(_count) + 1
    if (countFailure <= maxFailure) {
      await redis.set(RedisKeys.Failed(config.exchange, o.symbol, o.type), countFailure)
    }
  } else {
    countFailure = 1
    await redis.set(RedisKeys.Failed(config.exchange, o.symbol, o.type), 1)
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
    await redis.del(RedisKeys.Failed(config.exchange, o.symbol, o.type))
  } else {
    const markPrice = await getMarkPrice(redis, config.exchange, o.symbol)
    console.error('-------------------------------------------------------')
    console.error(
      JSON.stringify({
        count: countFailure,
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
    pl: round(pl, 4),
    closePrice: sto.openPrice,
    closeTime: sto.closeTime,
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
  for (const lo of tpOrders) {
    const isTraded = await syncStatus(lo)
    if (!isTraded) continue

    const info = await getSymbolInfo(redis, config.exchange, lo.symbol)
    if (!info) continue

    if (!lo.openOrderId) continue
    const oo = await db.getOrder(lo.openOrderId)
    if (!oo) {
      lo.closeTime = new Date()
      if (await db.updateOrder(lo)) {
        const event = Events.TakeProfit
        await logger.info(event, lo)
      }
      continue
    }

    oo.closeOrderId = lo.id
    oo.closePrice = lo.openPrice
    oo.closeTime = new Date()
    oo.pl = round((oo.closePrice - oo.openPrice) * lo.qty - oo.commission - lo.commission, 4)
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

  const tpOrders = await db.getShortTPNewOrders({})
  for (const sto of tpOrders) {
    const isTraded = await syncStatus(sto)
    if (!isTraded) continue

    const info = await getSymbolInfo(redis, config.exchange, sto.symbol)
    if (!info) continue

    if (!sto.openOrderId) continue
    const oo = await db.getOrder(sto.openOrderId)
    if (!oo) {
      sto.closeTime = new Date()
      if (await db.updateOrder(sto)) {
        const event = Events.TakeProfit
        await logger.info(event, sto)
      }
      continue
    }

    oo.closeOrderId = sto.id
    oo.closePrice = sto.openPrice
    oo.closeTime = new Date()
    oo.pl = round((oo.openPrice - oo.closePrice) * sto.qty - oo.commission - sto.commission, 4)
    if (await db.updateOrder(oo)) {
      await logger.info(Events.Close, oo)
    }

    sto.closeTime = oo.closeTime
    await db.updateOrder(sto)
  }
}

async function syncStatus(o: Order): Promise<boolean> {
  const exo = await exchange.getOrder(o.symbol, o.id, o.refId)
  if (!exo) return false

  if (exo.status === OrderStatus.New) {
    if (config.timeSecCancel <= 0 || !o.openTime) return false

    const diff = difference(o.openTime, new Date(), { units: ['seconds'] })
    if ((diff?.seconds ?? 0) < config.timeSecCancel) return false

    const resp = await exchange.cancelOrder(o.symbol, o.id, o.refId)
    if (!resp) return false

    o.status = resp.status
    o.updateTime = resp.updateTime
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

async function syncOrphanOrders() {
  const lOrders = await db.getLongFilledOrders({})
  const lTpOrders = await db.getLongTPNewOrders({})
  for (const lo of [...lOrders, ...lTpOrders]) {
    const pr = (await exchange.getPositionRisks(lo.symbol)).find(
      (p) => p.positionSide === OrderPositionSide.Long
    )
    if (toNumber(pr?.positionAmt ?? 0) === 0) {
      await db.updateOrder({ ...lo, closeTime: new Date() })
    }
  }

  const sOrders = await db.getShortFilledOrders({})
  const sTpOrders = await db.getShortTPNewOrders({})
  for (const so of [...sOrders, ...sTpOrders]) {
    const pr = (await exchange.getPositionRisks(so.symbol)).find(
      (p) => p.positionSide === OrderPositionSide.Short
    )
    if (toNumber(pr?.positionAmt ?? 0) === 0) {
      await db.updateOrder({ ...so, closeTime: new Date() })
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
  const id4 = setInterval(() => syncOrphanOrders(), 300000) // 5m

  gracefulShutdown([id1, id2, id3, id4])
}

main()
