import { Pool, PoolClient } from 'https://deno.land/x/postgres@v0.15.0/mod.ts'

import { camelize } from '../helper/camelize.js'
import { Order } from '../types/index.ts'

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

  async createOrder(order: Order) {
    const q = `
    INSERT INTO orders (id, ref_id, exchange, symbol, bot_id, side, position_side, type,
      status, qty, zone_price, open_price, close_price, commission, pl, open_order_id,
      close_order_id, open_time, close_time, update_time
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
    `
    const { rows } = await this.client.queryArray(q, [order.id])
    return rows.map((r) => camelize(r))
  }

  async updateOrder(order: Order) {
    const q = `
    UPDATE orders SET commission = ? WHERE id = ?
    `
    const { rows } = await this.client.queryArray(q, [order.commission, order.id])
    return rows.map((r) => camelize(r))
  }

  async getOrders() {
    const { rows } = await this.client.queryArray(`SELECT * FROM orders LIMIT 5`)
    return rows.map((r) => camelize(r))
  }
}
