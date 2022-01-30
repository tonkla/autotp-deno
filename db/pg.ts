import { Pool, PoolClient } from 'https://deno.land/x/postgres@v0.15.0/mod.ts'

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
    const rows = await this.client.queryArray(`INSERT INTO orders (id) VALUES (?)`, [order.id])
    console.log(rows)
  }

  async updateOrder(order: Order) {
    const rows = await this.client.queryArray(`UPDATE orders SET commission = ? WHERE id = ?`, [
      order.commission,
      order.id,
    ])
    console.log(rows)
  }

  async getOrders() {
    const rows = await this.client.queryArray(`SELECT * FROM orders LIMIT 5`)
    console.log(rows)
  }
}
