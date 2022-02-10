import { Pool, PoolClient } from 'https://deno.land/x/postgres@v0.15.0/mod.ts'

import { OrderPositionSide, OrderStatus, OrderType } from '../consts/index.ts'
import { camelize } from '../helper/camelize.js'
import { Order, QueryOrder } from '../types/index.ts'

export class PostgreSQL {
  private client!: PoolClient

  async connect(uri: string) {
    const pool = new Pool(uri, 5)
    this.client = await pool.connect()
    return this
  }

  close() {
    this.client.release()
  }

  async createOrder(order: Order): Promise<boolean> {
    const q = `
    INSERT INTO orders (id, ref_id, exchange, symbol, bot_id, side, position_side, type,
      status, qty, zone_price, open_price, close_price, commission, pl, open_order_id,
      close_order_id, open_time, close_time, update_time
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
    `
    const { rows } = await this.client.queryArray(q, [order.id])
    return rows.length > 0
  }

  async updateOrder(order: Order): Promise<boolean> {
    const q = `UPDATE orders SET commission = ? WHERE id = ?`
    const { rows } = await this.client.queryArray(q, [order.commission, order.id])
    return rows.length > 0
  }

  async baseFQ(qo: QueryOrder): Promise<Order[]> {
    if (qo.symbol) {
      const query = `SELECT * FROM orders WHERE exchange = $1 AND symbol = $2 AND bot_id = $3
        AND position_side = $4 AND type = $5 AND status = $6 AND close_time IS NULL`
      const values = [
        qo.exchange ?? '',
        qo.symbol ?? '',
        qo.botId ?? '',
        qo.positionSide ?? '',
        qo.type ?? '',
        qo.status ?? '',
      ]
      const { rows } = await this.client.queryArray(query, values)
      return rows.map((r) => camelize(r))
    } else {
      const query = `SELECT * FROM orders WHERE exchange = $1 AND bot_id = $2
        AND position_side = $3 AND type = $4 AND status = $5 AND close_time IS NULL`
      const values = [
        qo.exchange ?? '',
        qo.botId ?? '',
        qo.positionSide ?? '',
        qo.type ?? '',
        qo.status ?? '',
      ]
      const { rows } = await this.client.queryArray(query, values)
      return rows.map((r) => camelize(r))
    }
  }

  getLongLimitNewOrders(qo: QueryOrder): Promise<Order[]> {
    return this.baseFQ({
      ...qo,
      positionSide: OrderPositionSide.Long,
      type: OrderType.Limit,
      status: OrderStatus.New,
    })
  }

  getLongLimitFilledOrders(qo: QueryOrder): Promise<Order[]> {
    return this.baseFQ({
      ...qo,
      positionSide: OrderPositionSide.Long,
      type: OrderType.Limit,
      status: OrderStatus.Filled,
    })
  }

  getLongSLNewOrders(qo: QueryOrder): Promise<Order[]> {
    return this.baseFQ({
      ...qo,
      positionSide: OrderPositionSide.Long,
      type: OrderType.FSL,
      status: OrderStatus.New,
    })
  }

  getLongSLFilledOrders(qo: QueryOrder): Promise<Order[]> {
    return this.baseFQ({
      ...qo,
      positionSide: OrderPositionSide.Long,
      type: OrderType.FSL,
      status: OrderStatus.Filled,
    })
  }

  getLongTPNewOrders(qo: QueryOrder): Promise<Order[]> {
    return this.baseFQ({
      ...qo,
      positionSide: OrderPositionSide.Long,
      type: OrderType.FTP,
      status: OrderStatus.New,
    })
  }

  getLongTPFilledOrders(qo: QueryOrder): Promise<Order[]> {
    return this.baseFQ({
      ...qo,
      positionSide: OrderPositionSide.Long,
      type: OrderType.FTP,
      status: OrderStatus.Filled,
    })
  }

  getShortLimitNewOrders(qo: QueryOrder): Promise<Order[]> {
    return this.baseFQ({
      ...qo,
      positionSide: OrderPositionSide.Short,
      type: OrderType.Limit,
      status: OrderStatus.New,
    })
  }

  getShortLimitFilledOrders(qo: QueryOrder): Promise<Order[]> {
    return this.baseFQ({
      ...qo,
      positionSide: OrderPositionSide.Short,
      type: OrderType.Limit,
      status: OrderStatus.Filled,
    })
  }

  getShortSLNewOrders(qo: QueryOrder): Promise<Order[]> {
    return this.baseFQ({
      ...qo,
      positionSide: OrderPositionSide.Short,
      type: OrderType.FSL,
      status: OrderStatus.New,
    })
  }

  getShortSLFilledOrders(qo: QueryOrder): Promise<Order[]> {
    return this.baseFQ({
      ...qo,
      positionSide: OrderPositionSide.Short,
      type: OrderType.FSL,
      status: OrderStatus.Filled,
    })
  }

  getShortTPNewOrders(qo: QueryOrder): Promise<Order[]> {
    return this.baseFQ({
      ...qo,
      positionSide: OrderPositionSide.Short,
      type: OrderType.FTP,
      status: OrderStatus.New,
    })
  }

  getShortTPFilledOrders(qo: QueryOrder): Promise<Order[]> {
    return this.baseFQ({
      ...qo,
      positionSide: OrderPositionSide.Short,
      type: OrderType.FTP,
      status: OrderStatus.Filled,
    })
  }

  async getNearestOrder(qo: QueryOrder): Promise<Order | null> {
    if (!qo.openPrice) return null

    let norder: Order | null = null

    const query = `SELECT * FROM orders WHERE exchange = $1 AND symbol = $2 AND bot_id = $3
      AND position_side = $4 AND type = $5 AND status <> $6 AND close_time IS NULL`
    const values = [
      qo.exchange ?? '',
      qo.symbol ?? '',
      qo.botId ?? '',
      qo.positionSide ?? '',
      OrderType.Limit,
      OrderStatus.Canceled,
    ]
    const { rows } = await this.client.queryObject<Order>(query, values)
    if (rows.length === 0) return null
    for (const order of rows) {
      if (
        !norder ||
        Math.abs(order.openPrice - qo.openPrice) < Math.abs(norder.openPrice - qo.openPrice)
      ) {
        norder = order
      }
    }
    return norder
  }
}
