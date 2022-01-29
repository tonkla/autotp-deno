import { DB } from 'https://deno.land/x/sqlite/mod.ts'

import { Order } from '../types/index.ts'

export function connect(filename: string): DB {
  return new DB(filename || 'autotp.db')
}

export function createOrder(db: DB, order: Order) {
  const rows = db.query(`INSERT INTO orders (id) VALUES (?)`, [order.id])
  console.log(rows)
}

export function updateOrder(db: DB, order: Order) {
  const rows = db.query(`UPDATE orders SET commission = ? WHERE id = ?`, [
    order.commission,
    order.id,
  ])
  console.log(rows)
}

export function getOrders(db: DB) {
  const rows = db.query(`SELECT * FROM orders LIMIT 5`)
  console.log(rows)
}
