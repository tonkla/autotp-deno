import { connect } from 'https://deno.land/x/redis@v0.25.4/mod.ts'

import { PostgreSQL } from '../../db/pgbf.ts'
import { RedisKeys, getMarkPrice } from '../../db/redis.ts'
import { Errors } from '../../exchange/binance/enums.ts'
import { PrivateApi } from '../../exchange/binance/futures.ts'
import { wsOrderUpdate } from '../../exchange/binance/futures-ws.ts'
import { round, toNumber } from '../../helper/number.ts'
import { Logger, Events, Transports } from '../../service/logger.ts'
import { OrderPositionSide, OrderSide, OrderStatus, OrderType } from '../../consts/index.ts'
import { Order, Ticker } from '../../types/index.ts'
import { getConfig } from './config.ts'

const config = await getConfig()

const db = await new PostgreSQL().connect(config.dbUri)

const redis = await connect({ hostname: '127.0.0.1', port: 6379 })

const exchange = new PrivateApi(config.apiKey, config.secretKey)

const logger = new Logger([Transports.Console, Transports.Telegram], {
  telegramBotToken: config.telegramBotToken,
  telegramChatId: config.telegramChatId,
})

const wsList: WebSocket[] = []

async function placeOrder() {
  const _o = await redis.get(RedisKeys.Order(config.exchange))
  if (!_o) return
  const o: Order = JSON.parse(_o)
  if (o.status === OrderStatus.Canceled) {
    const co = await exchange.cancelOrder(o.symbol, o.id, o.refId)
    if (co && typeof co !== 'number') {
      if (co.status === OrderStatus.Canceled) {
        if (await db.updateOrder({ ...o, updateTime: co.updateTime, closeTime: new Date() })) {
          await logger.info(Events.Cancel, o)
        }
      }
    } else {
      await logger.log(JSON.stringify({ fn: 'placeOrder', error: co, symbol: o.symbol, id: o.id }))
      await db.updateOrder({ ...o, updateTime: new Date(), closeTime: new Date() })
    }
  } else {
    if (([OrderType.Limit, OrderType.FSL, OrderType.FTP] as string[]).includes(o.type)) {
      const exo = await exchange.placeLimitOrder(o)
      if (exo && typeof exo !== 'number') {
        if (await db.createOrder(exo)) {
          await logger.info(Events.Create, exo)
          await redis.del(RedisKeys.Failed(config.exchange, o.botId, o.symbol, o.type))
        }
      } else if (exo !== Errors.OrderWouldImmediatelyTrigger) {
        await db.updateOrder({ ...o, closeTime: new Date() })
        await redis.del(RedisKeys.Failed(config.exchange, o.botId, o.symbol, o.type))
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
      }
      await redis.del(RedisKeys.Failed(config.exchange, o.botId, o.symbol, o.type))
    }
  }
  await redis.del(RedisKeys.Order(config.exchange))
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

  if (countFailure <= maxFailure) return

  const sto = await exchange.placeMarketOrder(o)
  if (sto && typeof sto !== 'number') {
    if (([OrderType.FSL, OrderType.FTP] as string[]).includes(o.type)) {
      sto.updateTime = sto.openTime
      sto.closeTime = sto.openTime
      if (await db.createOrder(sto)) {
        await closeOpenOrder(sto)
      }
    } else if (await db.createOrder(sto)) {
      await logger.info(Events.Create, sto)
    }
  } else {
    await logger.log(JSON.stringify({ fn: 'retry', error: sto, symbol: o.symbol, id: o.id }))
    await closeOpenOrder(o)
  }
  await redis.del(RedisKeys.Failed(config.exchange, o.botId, o.symbol, o.type))
}

async function closeOpenOrder(sto: Order) {
  if (sto.commission === 0) {
    const priceBNB = await getMarkPrice(redis, config.exchange, 'BNBUSDT')
    const exorders = await exchange.getTradesList(sto.symbol, 5)
    for (const exo of exorders) {
      if (exo.refId !== sto.refId) continue
      const comm = exo.commissionAsset === 'BNB' ? exo.commission * priceBNB : exo.commission
      sto.commission = round(comm, 5)
      if (exo.openPrice > 0) sto.openPrice = exo.openPrice
      sto.updateTime = exo.updateTime
      sto.status = OrderStatus.Filled
      await db.updateOrder(sto)
      break
    }
  }

  if (!sto.openOrderId) return

  const oo = await db.getOrder(sto.openOrderId)
  if (!oo || oo.closeTime) return

  const pl =
    oo.positionSide === OrderPositionSide.Long
      ? sto.openPrice - oo.openPrice
      : oo.openPrice - sto.openPrice
  oo.pl = sto.openPrice > 0 ? round(pl * sto.qty - sto.commission - oo.commission, 4) : 0
  oo.closePrice = sto.openPrice
  oo.closeTime = sto.closeTime ?? new Date()
  oo.closeOrderId = sto.id
  if (await db.updateOrder(oo)) {
    await logger.info(Events.Close, oo)
  }
}

async function syncStatus(o: Order, exo: Order): Promise<Order> {
  if (o.status === exo.status) return { ...o }

  o.status = exo.status
  o.updateTime = exo.updateTime

  const canceled: string[] = [OrderStatus.Canceled, OrderStatus.Expired, OrderStatus.Rejected]
  if (canceled.includes(exo.status)) {
    o.closeTime = new Date()
  }

  if (await db.updateOrder(o)) {
    await logger.info(Events.Update, o)
  }

  return { ...o }
}

async function syncPlacedOrder(o: Order, exo: Order) {
  if (exo.status !== OrderStatus.Filled) return

  const priceBNB = await getMarkPrice(redis, config.exchange, 'BNBUSDT')
  const comm = exo.commissionAsset === 'BNB' ? exo.commission * priceBNB : exo.commission
  o.commission = round(comm, 5)
  o.updateTime = exo.updateTime
  o.status = OrderStatus.Filled
  if (exo.openPrice > 0) {
    o.openPrice = exo.openPrice
  }
  if (([OrderType.FSL, OrderType.FTP] as string[]).includes(o.type)) {
    o.pl = round(exo.pl, 4)
  }
  await db.updateOrder(o)

  const sto = { ...o }
  if (!sto.openOrderId) return

  sto.closeTime = new Date()
  await db.updateOrder(sto)

  const oo = await db.getOrder(sto.openOrderId)
  if (!oo || oo.closeTime) return

  const pl =
    oo.positionSide === OrderPositionSide.Long
      ? sto.openPrice - oo.openPrice
      : oo.openPrice - sto.openPrice
  oo.pl = round(pl * sto.qty - sto.commission - oo.commission, 4)
  oo.closePrice = sto.openPrice
  oo.closeTime = sto.closeTime
  oo.closeOrderId = sto.id
  if (await db.updateOrder(oo)) {
    await logger.info(Events.Close, oo)
  }
}

async function syncWithExchange() {
  const orders = await db.getNewOrders()
  for (const o of orders) {
    const exo = await exchange.getOrder(o.symbol, o.id, o.refId)
    if (!exo) continue

    const so = await syncStatus(o, exo)

    if (so.commission > 0) continue

    const exOrders = await exchange.getTradesList(so.symbol, 5)
    for (const exo of exOrders) {
      if (exo.refId !== so.refId) continue
      await syncPlacedOrder(so, exo)
      break
    }
  }
}

async function syncWithLocal(exo: Order) {
  const o = await db.getOrder(exo.id)
  if (!o) return

  const so = await syncStatus(o, exo)

  if (so.commission > 0) return

  await syncPlacedOrder(so, exo)
}

async function connectUserDataStream() {
  await exchange.stopUserDataStream()
  while (wsList.length > 0) {
    const ws = wsList.pop()
    if (ws) ws.close()
  }
  const listenKey = await exchange.startUserDataStream()
  wsList.push(wsOrderUpdate(listenKey, (o: Order) => syncWithLocal(o)))
}

async function closeOrphanPositions() {
  const positions = await exchange.getOpenPositions()
  for (const p of positions) {
    if (p.positionAmt === 0) continue
    const orders = await db.getOrphanOrders(p.symbol, p.positionSide)
    if (orders.length > 0) continue
    const side = p.positionSide === OrderPositionSide.Long ? OrderSide.Sell : OrderSide.Buy
    const order: Order = {
      exchange: '',
      botId: '',
      id: '',
      refId: '',
      symbol: p.symbol,
      side,
      positionSide: p.positionSide,
      type: OrderType.Market,
      status: OrderStatus.New,
      qty: Math.abs(p.positionAmt),
      openPrice: 0,
      closePrice: 0,
      commission: 0,
      pl: 0,
    }
    await exchange.placeMarketOrder(order)
  }
}

async function updateMaxProfit() {
  const orders = await db.getAllOpenLimitOrders()
  for (const order of orders) {
    const _mp = await redis.get(RedisKeys.MarkPrice(config.exchange, order.symbol))
    if (!_mp) continue
    const mp: Ticker = JSON.parse(_mp)
    const pip =
      order.positionSide === OrderPositionSide.Long
        ? mp.price - order.openPrice
        : order.openPrice - mp.price
    const profit = pip * order.qty - order.commission
    if ((order.maxPip ?? 0) < pip) {
      await db.updateOrder({ ...order, maxPip: pip, maxProfit: profit })
    }
  }
}

function clean(intervalIds: number[]) {
  for (const id of intervalIds) {
    clearInterval(id)
  }
  while (wsList.length > 0) {
    const ws = wsList.pop()
    if (ws) ws.close()
  }
  db.close()
}

function gracefulShutdown(intervalIds: number[]) {
  Deno.addSignalListener('SIGINT', () => clean(intervalIds))
  Deno.addSignalListener('SIGTERM', () => clean(intervalIds))
}

async function main() {
  await redis.del(RedisKeys.Order(config.exchange))

  const id1 = setInterval(() => placeOrder(), 2000)

  syncWithExchange()
  const id2 = setInterval(() => syncWithExchange(), 60000) // 1m

  connectUserDataStream()
  const id3 = setInterval(() => connectUserDataStream(), 1800000) // 30m

  closeOrphanPositions()
  const id4 = setInterval(() => closeOrphanPositions(), 30000) // 30s

  const id5 = setInterval(() => db.deleteCanceledOrders(), 600000) // 10m

  const id6 = setInterval(() => updateMaxProfit(), 1000) // 1s

  gracefulShutdown([id1, id2, id3, id4, id5, id6])
}

main()
