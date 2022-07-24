import { bcrypt, dotenv, hono, honomd, redis as rd, server } from '../deps.ts'

import { OrderPositionSide, OrderStatus } from '../consts/index.ts'
import { PostgreSQL } from '../db/pgbf.ts'
import { getMarkPrice, RedisKeys } from '../db/redis.ts'
import { encode } from '../helper/crypto.ts'
import { round } from '../helper/number.ts'
import { buildMarketOrder } from '../helper/order.ts'
import { PositionRisk } from '../types/index.ts'

const env = dotenv.config()

const db = await new PostgreSQL().connect('', {
  database: env.DB_NAME,
  hostname: env.DB_HOST,
  port: env.DB_PORT,
  user: env.DB_USER,
  password: env.DB_PASS,
  tls: { enabled: false },
})

const redis = await rd.connect({ hostname: '127.0.0.1', port: 6379 })

const app = new hono.Hono()
app.use('*', honomd.cors())
app.use('/p/*', auth)

app.post('/login', logIn)

app.get('/p/opening', getOpeningOrders)
app.get('/p/pending', getPendingOrders)
app.get('/p/closed', getClosedOrders)
app.get('/p/account', getAccountInfo)

app.put('/p/orders/:id', closeOrder)

server.serve(app.fetch)

async function auth(c: hono.Context, next: hono.Next) {
  try {
    const a = c.req.headers.get('authorization')
    if (!a) {
      c.status(401)
      return c.json({ success: false, message: 'Unauthorized' })
    }

    const token = a.split('Bearer ')[1]
    if (!token) {
      c.status(401)
      return c.json({ success: false, message: 'Unauthorized' })
    }

    const { username, hmac } = JSON.parse(atob(token))
    if (hmac !== encode(username, env.SECRET)) {
      c.status(401)
      return c.json({ success: false, message: 'Unauthorized' })
    }

    await next()
  } catch {
    c.status(401)
    return c.json({ success: false, message: 'Unauthorized' })
  }
}

async function logIn(c: hono.Context) {
  try {
    const { username, password } = await c.req.parseBody()
    if (!username || !password) {
      c.status(400)
      return c.json({ success: false, message: 'Bad Request' })
    }

    if (username !== env.USERNAME || !bcrypt.compareSync(password, env.PASSWORD)) {
      c.status(400)
      return c.json({ success: false, message: 'Bad Request' })
    }

    const accessToken = btoa(JSON.stringify({ username, hmac: encode(username, env.SECRET) }))
    return c.json({ accessToken })
  } catch {
    c.status(400)
    return c.json({ success: false, message: 'Bad Request' })
  }
}

async function getOpeningOrders(c: hono.Context) {
  const porders = (await db.getAllOpenLimitOrders()).map(async (o) => {
    const mp = await getMarkPrice(redis, o.exchange ?? 'bn', o.symbol)
    if (mp === 0) return o
    const pl = o.positionSide === OrderPositionSide.Long ? mp - o.openPrice : o.openPrice - mp
    return { ...o, pl: round(pl * o.qty - o.commission, 4) }
  })
  return c.json({ orders: await Promise.all(porders) })
}

async function getPendingOrders(c: hono.Context) {
  const orders = await db.getNewOrders()
  return c.json({ orders })
}

async function getClosedOrders(c: hono.Context) {
  const orders = await db.getAllClosedLimitOrders()
  return c.json({ orders })
}

function getAccountInfo(c: hono.Context) {
  return c.json({ account: {} })
}

async function closeOrder(c: hono.Context) {
  const id = c.req.param('id')
  if (!id) {
    c.status(400)
    return c.json({ success: false, message: 'Bad Request' })
  }

  const order = await db.getOrder(id)
  if (!order || !order.positionSide || !order.exchange) {
    c.status(404)
    return c.json({ success: false, message: 'Not Found' })
  }

  if (order.status === OrderStatus.New) {
    await redis.set(
      RedisKeys.Order(order.exchange),
      JSON.stringify({ ...order, status: OrderStatus.Canceled })
    )
    return c.json({ success: true })
  }

  const _pos = await redis.get(RedisKeys.Position(order.exchange, order.symbol, order.positionSide))
  if (_pos) {
    const pos: PositionRisk = JSON.parse(_pos)
    if (Math.abs(pos.positionAmt) >= order.qty) {
      const _order = buildMarketOrder(order)
      await redis.set(RedisKeys.Order(order.exchange), JSON.stringify(_order))
      return c.json({ success: true })
    }
  }

  return c.json({ success: await db.closeOrder(id) })
}
