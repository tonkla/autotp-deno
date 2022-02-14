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
    this.client.end()
  }

  async createOrder(order: Order): Promise<boolean> {
    const query = `
    INSERT INTO bforders (id, ref_id, symbol, side, position_side, type,
      status, qty, open_price, close_price, commission, pl, open_order_id,
      close_order_id, open_time, close_time, update_time)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
    `
    const values = [
      order.id,
      order.refId,
      order.symbol,
      order.side,
      order.positionSide,
      order.type,
      order.status,
      order.qty,
      order.openPrice,
      order.closePrice,
      order.commission,
      order.pl,
      order.openOrderId,
      order.closeOrderId,
      order.openTime,
      order.closeTime,
      order.updateTime,
    ]
    const { rows } = await this.client.queryArray(query, values)
    return rows.length > 0
  }

  async updateOrder(order: Order): Promise<boolean> {
    const falsy: (string | number | boolean | null | undefined)[] = [false, '', null, undefined]
    const values = []
    const o = { ...order }
    let q = `UPDATE bforders SET`
    if (o.refId) {
      values.push(o.refId)
      q += ` ref_id=$${values.length},`
    }
    if (o.status) {
      values.push(o.status)
      q += ` status=$${values.length},`
    }
    if (o.openPrice) {
      values.push(o.openPrice)
      q += ` open_price=$${values.length},`
    }
    if (o.closePrice) {
      values.push(o.closePrice)
      q += ` close_price=$${values.length},`
    }
    if (!falsy.includes(o.commission)) {
      values.push(o.commission)
      q += ` commission=$${values.length},`
    }
    if (!falsy.includes(o.pl)) {
      values.push(o.pl)
      q += ` pl=$${values.length},`
    }
    if (o.openOrderId) {
      values.push(o.openOrderId)
      q += ` open_order_id=$${values.length},`
    }
    if (o.closeOrderId) {
      values.push(o.closeOrderId)
      q += ` close_order_id=$${values.length},`
    }
    if (o.openTime) {
      values.push(o.openTime)
      q += ` open_time=$${values.length},`
    }
    if (o.closeTime) {
      values.push(o.closeTime)
      q += ` close_time=$${values.length},`
    }
    if (o.updateTime) {
      values.push(o.updateTime)
      q += ` update_time=$${values.length},`
    }
    q = q.slice(0, -1) // Remove trailing comma
    values.push(o.id)
    q += ` WHERE id=$${values.length}`
    const { rows } = await this.client.queryObject(q, values)
    return rows.length > 0
  }

  async baseFQ(qo: QueryOrder): Promise<Order[]> {
    const orderBy = qo.orderBy ? qo.orderBy : 'id DESC'
    if (qo.symbol) {
      const query = `SELECT * FROM bforders WHERE symbol = $1 AND position_side = $2
        AND type = $3 AND status = $4 AND close_time IS NULL ORDER BY ${orderBy}`
      const values = [qo.symbol ?? '', qo.positionSide ?? '', qo.type ?? '', qo.status ?? '']
      const { rows } = await this.client.queryArray(query, values)
      return rows.map((r) => camelize(r))
    } else {
      const query = `SELECT * FROM bforders WHERE position_side = $1
        AND type = $2 AND status = $3 AND close_time IS NULL ORDER BY ${orderBy}`
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
      orderBy: 'open_price DESC',
    })
  }

  getLongLimitFilledOrders(qo: QueryOrder): Promise<Order[]> {
    return this.baseFQ({
      ...qo,
      positionSide: OrderPositionSide.Long,
      type: OrderType.Limit,
      status: OrderStatus.Filled,
      orderBy: 'open_price DESC',
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
      orderBy: 'open_price ASC',
    })
  }

  getShortLimitFilledOrders(qo: QueryOrder): Promise<Order[]> {
    return this.baseFQ({
      ...qo,
      positionSide: OrderPositionSide.Short,
      type: OrderType.Limit,
      status: OrderStatus.Filled,
      orderBy: 'open_price ASC',
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

  async getOrder(id: string): Promise<Order | null> {
    const query = `SELECT * FROM bforders WHERE id = $1`
    const { rows } = await this.client.queryObject<Order>(query, [id])
    return rows && rows.length > 0 ? camelize(rows[0]) : null
  }

  async getStopOrder(id: string, type: string): Promise<Order | null> {
    const query = `SELECT * FROM bforders WHERE open_order_id = $1 AND type = $2 AND status <> $3 AND close_time IS NULL`
    const { rows } = await this.client.queryObject<Order>(query, [id, type, OrderStatus.Canceled])
    return rows && rows.length > 0 ? camelize(rows[0]) : null
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
    return norder ? camelize(norder) : null
  }
}
