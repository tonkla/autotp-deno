import { pg } from '../deps.ts'

import { OrderPositionSide, OrderStatus, OrderType } from '../consts/index.ts'
import { camelize } from '../helper/camelize.js'
import { toNumber } from '../helper/number.ts'
import { Order, QueryOrder } from '../types/index.ts'

function format(order: unknown): Order {
  const o = camelize(order)
  return {
    ...o,
    qty: toNumber(o.qty),
    openPrice: toNumber(o.openPrice),
    closePrice: toNumber(o.closePrice),
    commission: toNumber(o.commission),
    pl: toNumber(o.pl),
    openOrderId: o.openOrderId ?? '',
    closeOrderId: o.closeOrderId ?? '',
  }
}

export class PostgreSQL {
  private client!: pg.PoolClient

  async connect(uri: string, options?: pg.ClientOptions) {
    if (!uri.trim() && !options) {
      throw new Error('Please provide database URI/ClientOptions')
    }
    const pool = new pg.Pool(options ? options : uri, 5)
    this.client = await pool.connect()
    return this
  }

  close() {
    this.client.release()
  }

  async getKV(k: string): Promise<{ k: string; v: string | null } | null> {
    try {
      const q = `SELECT * FROM kv WHERE k = $1`
      const { rows } = await this.client.queryObject(q, [k])
      return rows.length > 0 ? (rows[0] as { k: string; v: string | null }) : null
    } catch {
      return null
    }
  }

  async updateKV(k: string, v: string | null): Promise<boolean> {
    try {
      const q = `UPDATE kv SET v = $2 WHERE k = $1`
      await this.client.queryObject(q, [k, v])
      return true
    } catch {
      return false
    }
  }

  async createOrder(order: Order): Promise<boolean> {
    const query = `
    INSERT INTO bforders (id, ref_id, symbol, bot_id, side, position_side, type,
      status, qty, open_price, close_price, commission, pl, open_order_id,
      close_order_id, open_time, close_time, update_time, note)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
    `
    const values = [
      order.id,
      order.refId,
      order.symbol,
      order.botId,
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
      order.note || null,
    ]
    try {
      const { rowCount } = await this.client.queryObject(query, values)
      return toNumber(rowCount ?? 0) === 1
    } catch {
      return false
    }
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
    // if (!falsy.includes(o.maxPip)) {
    //   values.push(o.maxPip)
    //   q += ` max_pip=$${values.length},`
    // }
    // if (!falsy.includes(o.maxProfit)) {
    //   values.push(o.maxProfit)
    //   q += ` max_profit=$${values.length},`
    // }
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
    try {
      const { rowCount } = await this.client.queryObject(q, values)
      return toNumber(rowCount ?? 0) === 1
    } catch {
      return false
    }
  }

  async closeOrder(id: string, closePrice?: number, pl?: number): Promise<boolean> {
    try {
      if (!id.trim()) return false
      if (closePrice !== undefined && pl !== undefined) {
        const q = `UPDATE bforders SET close_time = NOW(), close_price = $2, pl = $3 WHERE id = $1`
        await this.client.queryObject(q, [id, closePrice ?? 0, pl ?? 0])
      } else {
        const q = `UPDATE bforders SET close_time = NOW() WHERE id = $1`
        await this.client.queryObject(q, [id])
      }
      return true
    } catch {
      return false
    }
  }

  async deleteCanceledOrders() {
    const query = `DELETE FROM bforders WHERE status = $1`
    await this.client.queryObject<Order>(query, [OrderStatus.Canceled])
  }

  async baseFQ(qo: QueryOrder): Promise<Order[]> {
    let query = 'SELECT * FROM bforders WHERE '
    const where: string[] = []
    const values: string[] = []
    const orderBy = qo.orderBy ? qo.orderBy : 'id DESC'

    if (qo.botId) {
      values.push(qo.botId)
      where.push(`bot_id = $${values.length}`)
    }
    if (qo.symbol) {
      values.push(qo.symbol)
      where.push(`symbol = $${values.length}`)
    }
    if (qo.types && qo.types.length > 0) {
      const types: string[] = []
      for (const t of qo.types) {
        values.push(t)
        types.push(`type = $${values.length}`)
      }
      if (qo.types.length === 1) {
        where.push(`${types[0]}`)
      } else {
        where.push(`(${types.join(' OR ')})`)
      }
    }
    if (qo.type) {
      values.push(qo.type)
      where.push(`type = $${values.length}`)
    }

    values.push(qo.positionSide ?? '')
    where.push(`position_side = $${values.length}`)

    values.push(qo.status ?? '')
    where.push(`status = $${values.length}`)

    query += `${where.join(' AND ')} AND close_time IS NULL ORDER BY ${orderBy}`

    const { rows } = await this.client.queryObject<Order>(query, values)
    return Array.isArray(rows) ? rows.map((r) => format(r)) : []
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

  getLongFilledOrders(qo: QueryOrder): Promise<Order[]> {
    return this.baseFQ({
      ...qo,
      positionSide: OrderPositionSide.Long,
      types: [OrderType.Limit, OrderType.Market],
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

  getShortFilledOrders(qo: QueryOrder): Promise<Order[]> {
    return this.baseFQ({
      ...qo,
      positionSide: OrderPositionSide.Short,
      types: [OrderType.Limit, OrderType.Market],
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

  async getAllOpenOrders(): Promise<Order[]> {
    const query = `SELECT * FROM bforders WHERE close_time IS NULL`
    const { rows } = await this.client.queryObject(query)
    return rows.map((r) => format(r))
  }

  async getAllOpenLimitOrders(): Promise<Order[]> {
    const query = `SELECT * FROM bforders WHERE type = $1 AND status = $2 AND close_time IS NULL
      ORDER BY open_time DESC`
    const { rows } = await this.client.queryObject(query, [OrderType.Limit, OrderStatus.Filled])
    return rows.map((r) => format(r))
  }

  async getAllClosedLimitOrders(offset = 0, limit = 20): Promise<Order[]> {
    const query = `SELECT * FROM bforders WHERE type = $1 AND status = $2 AND close_time IS NOT NULL
      ORDER BY close_time DESC OFFSET $3 LIMIT $4`
    const { rows } = await this.client.queryObject(query, [
      OrderType.Limit,
      OrderStatus.Filled,
      offset,
      limit,
    ])
    return rows.map((r) => format(r))
  }

  async getOpenOrders(botId: string): Promise<Order[]> {
    const query = `SELECT * FROM bforders WHERE bot_id = $1 AND close_time IS NULL`
    const { rows } = await this.client.queryObject(query, [botId])
    return rows.map((r) => format(r))
  }

  async getOpenOrdersBySymbol(symbol: string, posSide?: string): Promise<Order[]> {
    if (posSide) {
      const query = `SELECT * FROM bforders WHERE symbol = $1 AND position_side = $2 AND close_time IS NULL`
      const { rows } = await this.client.queryObject(query, [symbol, posSide])
      return rows.map((r) => format(r))
    } else {
      const query = `SELECT * FROM bforders WHERE symbol = $1 AND close_time IS NULL`
      const { rows } = await this.client.queryObject(query, [symbol])
      return rows.map((r) => format(r))
    }
  }

  async getNewOrders(botId?: string): Promise<Order[]> {
    if (botId) {
      const query = `SELECT * FROM bforders WHERE bot_id = $1 AND status = $2 AND close_time IS NULL
        ORDER BY open_time DESC`
      const { rows } = await this.client.queryObject(query, [botId, OrderStatus.New])
      return rows.map((r) => format(r))
    } else {
      const query = `SELECT * FROM bforders WHERE status = $1 AND close_time IS NULL
        ORDER BY open_time DESC`
      const { rows } = await this.client.queryObject(query, [OrderStatus.New])
      return rows.map((r) => format(r))
    }
  }

  async getExpiredOrders(): Promise<Order[]> {
    const query = `SELECT * FROM bforders WHERE status = $1`
    const { rows } = await this.client.queryObject<Order>(query, [OrderStatus.Expired])
    return rows.map((r) => format(r))
  }

  async getOrphanOrders(symbol: string, positionSide: string): Promise<Order[]> {
    const query = `SELECT * FROM bforders
      WHERE symbol = $1 AND position_side = $2 AND type = $3 AND close_time IS NULL`
    const { rows } = await this.client.queryObject(query, [symbol, positionSide, OrderType.Limit])
    return rows.map((r) => format(r))
  }

  async getOrder(id: string): Promise<Order | null> {
    const query = `SELECT * FROM bforders WHERE id = $1`
    const { rows } = await this.client.queryObject<Order>(query, [id])
    return rows && rows.length > 0 ? format(rows[0]) : null
  }

  async getStopOrder(id: string, type: string): Promise<Order | null> {
    const query = `SELECT * FROM bforders WHERE open_order_id = $1 AND (type = $2 OR type = $3) AND close_time IS NULL`
    const { rows } = await this.client.queryObject(query, [id, type, OrderType.Limit])
    return rows && rows.length > 0 ? format(rows[0]) : null
  }

  async getSiblingOrders(qo: QueryOrder): Promise<Order[]> {
    const query = `SELECT * FROM bforders WHERE symbol = $1 AND bot_id = $2
      AND position_side = $3 AND type = $4 AND status <> $5 AND close_time IS NULL
      ORDER BY open_price${qo.positionSide === OrderPositionSide.Long ? ' DESC' : ''}`

    const values = [
      qo.symbol ?? '',
      qo.botId ?? '',
      qo.positionSide ?? '',
      OrderType.Limit,
      OrderStatus.Canceled,
    ]

    const { rows } = await this.client.queryObject(query, values)
    return rows.map((r) => format(r))
  }

  async getNearestOrder(qo: QueryOrder): Promise<Order | null> {
    if (!qo.openPrice) return null

    const query = `SELECT * FROM bforders WHERE symbol = $1 AND bot_id = $2
      AND position_side = $3 AND type = $4 AND status <> $5 AND close_time IS NULL`

    const values = [
      qo.symbol ?? '',
      qo.botId ?? '',
      qo.positionSide ?? '',
      OrderType.Limit,
      OrderStatus.Canceled,
    ]

    const { rows } = await this.client.queryObject(query, values)
    if (rows.length === 0) return null

    let norder: Order | null = null

    for (const order of rows) {
      const o = format(order)
      if (
        !norder ||
        Math.abs(o.openPrice - qo.openPrice) < Math.abs(norder.openPrice - qo.openPrice)
      ) {
        norder = o
      }
    }
    return norder
  }
}
