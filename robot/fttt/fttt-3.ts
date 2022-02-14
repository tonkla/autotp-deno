import { difference } from 'https://deno.land/std@0.125.0/datetime/mod.ts'
import { connect } from 'https://deno.land/x/redis@v0.25.2/mod.ts'

import { PostgreSQL } from '../../db/pgbf.ts'
import { getSymbolInfo } from '../../db/redis.ts'
import { PrivateApi } from '../../exchange/binance/futures.ts'
import { round } from '../../helper/number.ts'
import { RedisKeys, OrderStatus, OrderType } from '../../consts/index.ts'
import { Order } from '../../types/index.ts'
import { getConfig } from './config.ts'

const config = await getConfig()

const db = await new PostgreSQL().connect(config.dbUri)

const exchange = new PrivateApi(config.apiKey, config.secretKey)

const redis = await connect({
  hostname: '127.0.0.1',
  port: 6379,
})

async function placeOrder() {
  const _order = await redis.lpop(RedisKeys.Orders(config.exchange))
  if (_order) {
    const order: Order = JSON.parse(_order)
    const newOrder = await exchange.placeOrder(order)
    if (newOrder) await db.createOrder(newOrder)
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
        console.info('Closed:', { symbol: lo.symbol, id: lo.id, type: lo.type })
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
      console.info('Closed:', { symbol: oo.symbol, id: oo.id, side: oo.positionSide, pl: oo.pl })
    }

    lo.closeTime = oo.closeTime
    if (await db.updateOrder(lo)) {
      console.info('Closed:', { symbol: lo.symbol, id: lo.id, type: lo.type })
    }
  }
}

async function syncShortOrders() {
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
        console.info('Closed:', { symbol: so.symbol, id: so.id, type: so.type })
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
      console.info('Closed:', { symbol: oo.symbol, id: oo.id, side: oo.positionSide, pl: oo.pl })
    }

    so.closeTime = oo.closeTime
    if (await db.updateOrder(so)) {
      console.info('Closed:', { symbol: so.symbol, id: so.id, type: so.type })
    }
  }
}

async function syncStatus(o: Order): Promise<boolean> {
  const exo = await exchange.getOrder(o.symbol, o.id, o.refId)
  if (!exo) return false

  if (exo.status === OrderStatus.New) {
    if (config.timeSecCancel <= 0 || !o.openTime) return false

    const diff = difference(new Date(o.openTime), new Date(), { units: ['seconds'] })
    if (diff < config.timeSecCancel) return false

    const res = await exchange.cancelOrder(o.symbol, o.id, o.refId)
    if (!res) return false

    o.status = res.status
    o.updateTime = res.updateTime
    o.closeTime = new Date()
    if (await db.updateOrder(o)) {
      console.info('Canceled:', { symbol: o.symbol, id: o.id })
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
      console.info('Status Changed:', { symbol: o.symbol, id: o.id, status: o.status })
    }
  }

  const orders = await exchange.getTradesList(o.symbol, 5)
  for (const to of orders) {
    if (to.refId === o.refId && !o.closeTime && o.status === OrderStatus.Filled) {
      o.commission = to.commission
      if (o.type !== OrderType.Limit) o.pl = to.pl
      if (await db.updateOrder(o)) {
        console.info('Commission:', {
          symbol: o.symbol,
          id: o.id,
          commission: o.commission,
          pl: o.pl,
        })
      }
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

function main() {
  console.info('\nFTTT-3 Started\n')

  placeOrder()
  const id1 = setInterval(() => placeOrder(), 1000)

  syncLongOrders()
  const id2 = setInterval(() => syncLongOrders(), 3000)

  syncShortOrders()
  const id3 = setInterval(() => syncShortOrders(), 3000)

  gracefulShutdown([id1, id2, id3])
}

main()
