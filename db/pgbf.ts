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
    INSERT INTO orders (id, ref_id, symbol, side, position_side, type,
      status, qty, zone_price, open_price, close_price, commission, pl, open_order_id,
      close_order_id, open_time, close_time, update_time
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
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
      const query = `SELECT * FROM bforders WHERE symbol = $1
        AND position_side = $2 AND type = $3 AND status = $4 AND close_time IS NULL`
      const values = [qo.symbol ?? '', qo.positionSide ?? '', qo.type ?? '', qo.status ?? '']
      const { rows } = await this.client.queryArray(query, values)
      return rows.map((r) => camelize(r))
    } else {
      const query = `SELECT * FROM bforders WHERE position_side = $1
        AND type = $2 AND status = $3 AND close_time IS NULL`
      const values = [qo.positionSide ?? '', qo.type ?? '', qo.status ?? '']
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

  async getStopOrder(id: string, type: string): Promise<Order | null> {
    const query = `SELECT * FROM bforders WHERE open_order_id = $1 AND type = $2 AND status <> $3 AND close_time IS NULL`
    const { rows } = await this.client.queryObject<Order>(query, [id, type, OrderStatus.Canceled])
    return rows && rows.length > 0 ? rows[0] : null
  }

  async getNearestOrder(qo: QueryOrder): Promise<Order | null> {
    if (!qo.openPrice) return null

    let norder: Order | null = null

    const query = `SELECT * FROM bforders WHERE symbol = $1
      AND position_side = $2 AND type = $3 AND status <> $4 AND close_time IS NULL`
    const values = [qo.symbol ?? '', qo.positionSide ?? '', OrderType.Limit, OrderStatus.Canceled]
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
