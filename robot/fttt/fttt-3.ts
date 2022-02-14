import { connect } from 'https://deno.land/x/redis@v0.25.2/mod.ts'

import { PostgreSQL } from '../../db/pgbf.ts'
import { getSymbolInfo } from '../../db/redis.ts'
import { PrivateApi } from '../../exchange/binance/futures.ts'
import { round } from '../../helper/number.ts'
import { RedisKeys, OrderStatus, OrderPositionSide } from '../../consts/index.ts'
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

async function syncLimitOrders() {
  const longOrders = await db.getLongLimitNewOrders({})
  const shortOrders = await db.getShortLimitNewOrders({})
  for (const o of [...longOrders, ...shortOrders]) {
    await syncStatus(o)
  }
}

async function syncSLOrders() {
  const longOrders = await db.getLongSLNewOrders({})
  const shortOrders = await db.getShortSLNewOrders({})
  for (const slo of [...longOrders, ...shortOrders]) {
    const isTraded = await syncStatus(slo)
    if (isTraded) {
      const info = await getSymbolInfo(redis, config.exchange, slo.symbol)
      if (!info) continue

      const oo = await db.getOrder(slo.openOrderId ?? '')
      if (!oo) {
        slo.closeTime = new Date()
        await db.updateOrder(slo)
        continue
      }

      oo.closeOrderId = slo.id
      oo.closePrice = slo.openPrice
      oo.closeTime = new Date()
      oo.pl =
        oo.positionSide === OrderPositionSide.Long
          ? round(
              (oo.closePrice - oo.openPrice) * slo.qty - oo.commission - slo.commission,
              info.pricePrecision
            )
          : round(
              (oo.openPrice - oo.closePrice) * slo.qty - oo.commission - slo.commission,
              info.pricePrecision
            )
      await db.updateOrder(oo)

      slo.closeTime = oo.closeTime
      await db.updateOrder(slo)

      // TODO: log
    }
  }
}

async function syncTPOrders() {
  const longOrders = await db.getLongTPNewOrders({})
  const shortOrders = await db.getShortTPNewOrders({})
  for (const tpo of [...longOrders, ...shortOrders]) {
    const isTraded = await syncStatus(tpo)
    if (isTraded) {
      const info = await getSymbolInfo(redis, config.exchange, tpo.symbol)
      if (!info) continue

      const oo = await db.getOrder(tpo.openOrderId ?? '')
      if (!oo) {
        tpo.closeTime = new Date()
        await db.updateOrder(tpo)
        continue
      }

      oo.closeOrderId = tpo.id
      oo.closePrice = tpo.openPrice
      oo.closeTime = new Date()
      oo.pl =
        oo.positionSide === OrderPositionSide.Long
          ? round(
              (oo.closePrice - oo.openPrice) * tpo.qty - oo.commission - tpo.commission,
              info.pricePrecision
            )
          : round(
              (oo.openPrice - oo.closePrice) * tpo.qty - oo.commission - tpo.commission,
              info.pricePrecision
            )
      await db.updateOrder(oo)

      tpo.closeTime = oo.closeTime
      await db.updateOrder(tpo)

      // TODO: log
    }
  }
}

async function syncStatus(o: Order): Promise<boolean> {
  const exo = await exchange.getOrder(o.symbol, o.id, o.refId)
  if (!exo) return false

  if (exo.status === OrderStatus.New) {
    // TODO: time-based cancel
  }

  if (exo.status !== o.status) {
    o.status = exo.status
    o.updateTime = exo.updateTime

    const canceled: string[] = [OrderStatus.Canceled, OrderStatus.Expired, OrderStatus.Rejected]
    if (canceled.includes(exo.status)) {
      o.closeTime = new Date()
    }

    if (exo.status === OrderStatus.Filled) {
      // TODO: update commission
    }

    await db.updateOrder(o)
  }

  const orders = await exchange.getTradesList(o.symbol, 5)
  for (const to of orders) {
    if (o.refId === to.refId && !o.closeTime && o.status === OrderStatus.Filled) {
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

  syncLimitOrders()
  const id2 = setInterval(() => syncLimitOrders(), 3000)

  syncSLOrders()
  const id3 = setInterval(() => syncSLOrders(), 3000)

  syncTPOrders()
  const id4 = setInterval(() => syncTPOrders(), 3000)

  gracefulShutdown([id1, id2, id3, id4])
}

main()
