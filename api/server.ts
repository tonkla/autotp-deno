import { bcrypt, dotenv, hono, honomd, redis as rd, server } from '../deps.ts'

import { OrderPositionSide, OrderSide, OrderStatus, OrderType } from '../consts/index.ts'
import { PostgreSQL } from '../db/pgbf.ts'
import { getMarkPrice, getSymbolInfo, RedisKeys } from '../db/redis.ts'
import { encode } from '../helper/crypto.ts'
import { round, toNumber } from '../helper/number.ts'
import { buildStopOrder } from '../helper/order.ts'
import { calcStopLower, calcStopUpper } from '../helper/price.ts'
import { Order, PositionRisk, SymbolInfo } from '../types/index.ts'

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

server.serve(app.fetch, { hostname: '127.0.0.1' })

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

type LoginParams = {
  username: string
  password: string
}
async function logIn(c: hono.Context) {
  try {
    const { username, password } = (await c.req.parseBody()) as LoginParams
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
    const mp = await getMarkPrice(redis, o.exchange ?? env.EXCHANGE, o.symbol)
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
  const { offset, limit } = c.req.query()
  const orders = await db.getAllClosedLimitOrders(toNumber(offset), toNumber(limit))
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

  const { action } = c.req.query()
  if (!action) {
    c.status(400)
    return c.json({ success: false, message: 'Bad Request' })
  }

  const order = await db.getOrder(id)
  if (!order || !order.positionSide) {
    c.status(404)
    return c.json({ success: false, message: 'Not Found' })
  }

  if (order.status === OrderStatus.New) {
    await redis.set(
      RedisKeys.Order(env.EXCHANGE),
      JSON.stringify({ ...order, status: OrderStatus.Canceled })
    )
    return c.json({ success: true })
  }

  const _pos = await redis.get(RedisKeys.Position(env.EXCHANGE, order.symbol, order.positionSide))
  if (_pos) {
    const pos: PositionRisk = JSON.parse(_pos)
    if (Math.abs(pos.positionAmt) >= order.qty) {
      const _order =
        action === 'SL'
          ? await buildSLOrder(order)
          : action === 'TP'
          ? await buildTPOrder(order)
          : null
      if (!_order) return c.json({ success: false })
      await redis.set(RedisKeys.Order(env.EXCHANGE), JSON.stringify(_order))
      return c.json({ success: true })
    }
  }
  return c.json({ success: await db.closeOrder(id) })
}

async function buildSLOrder(o: Order): Promise<Order | null> {
  if (await db.getStopOrder(o.id, OrderType.FSL)) return null

  const info = await getSymbolInfo(redis, env.EXCHANGE, o.symbol)
  if (!info?.pricePrecision) return null

  const markPrice = await getMarkPrice(redis, env.EXCHANGE, o.symbol, 5)
  if (markPrice === 0) return null

  return o.positionSide === OrderPositionSide.Long
    ? buildLongSLOrder(o, info, markPrice)
    : buildShortSLOrder(o, info, markPrice)
}

async function buildTPOrder(o: Order): Promise<Order | null> {
  if (await db.getStopOrder(o.id, OrderType.FTP)) return null

  const info = await getSymbolInfo(redis, env.EXCHANGE, o.symbol)
  if (!info?.pricePrecision) return null

  const markPrice = await getMarkPrice(redis, env.EXCHANGE, o.symbol, 5)
  if (markPrice === 0) return null

  return o.positionSide === OrderPositionSide.Long
    ? buildLongTPOrder(o, info, markPrice)
    : buildShortTPOrder(o, info, markPrice)
}

async function gap(symbol: string, botId: string, type: string, gap: number): Promise<number> {
  const count = await redis.get(RedisKeys.Failed(env.EXCHANGE, botId, symbol, type))
  return count ? toNumber(count) * 5 + gap : gap
}

async function buildLongSLOrder(
  o: Order,
  info: SymbolInfo,
  markPrice: number
): Promise<Order | null> {
  const stopPrice = calcStopLower(
    markPrice,
    await gap(o.symbol, o.botId, OrderType.FSL, 5),
    info.pricePrecision
  )
  const slPrice = calcStopLower(
    markPrice,
    await gap(o.symbol, o.botId, OrderType.FSL, 10),
    info.pricePrecision
  )
  if (slPrice <= 0) return null
  return buildStopOrder(
    env.EXCHANGE,
    o.botId,
    o.symbol,
    OrderSide.Sell,
    OrderPositionSide.Long,
    OrderType.FSL,
    stopPrice,
    slPrice,
    o.qty,
    o.id
  )
}

async function buildLongTPOrder(
  o: Order,
  info: SymbolInfo,
  markPrice: number
): Promise<Order | null> {
  const stopPrice = calcStopUpper(
    markPrice,
    await gap(o.symbol, o.botId, OrderType.FTP, 5),
    info.pricePrecision
  )
  const tpPrice = calcStopUpper(
    markPrice,
    await gap(o.symbol, o.botId, OrderType.FTP, 10),
    info.pricePrecision
  )
  if (tpPrice <= 0 || stopPrice <= 0) return null
  return buildStopOrder(
    env.EXCHANGE,
    o.botId,
    o.symbol,
    OrderSide.Sell,
    OrderPositionSide.Long,
    OrderType.FTP,
    stopPrice,
    tpPrice,
    o.qty,
    o.id
  )
}

async function buildShortSLOrder(
  o: Order,
  info: SymbolInfo,
  markPrice: number
): Promise<Order | null> {
  const stopPrice = calcStopUpper(
    markPrice,
    await gap(o.symbol, o.botId, OrderType.FSL, 5),
    info.pricePrecision
  )
  const slPrice = calcStopUpper(
    markPrice,
    await gap(o.symbol, o.botId, OrderType.FSL, 10),
    info.pricePrecision
  )
  if (slPrice <= 0) return null
  return buildStopOrder(
    env.EXCHANGE,
    o.botId,
    o.symbol,
    OrderSide.Buy,
    OrderPositionSide.Short,
    OrderType.FSL,
    stopPrice,
    slPrice,
    o.qty,
    o.id
  )
}

async function buildShortTPOrder(
  o: Order,
  info: SymbolInfo,
  markPrice: number
): Promise<Order | null> {
  const stopPrice = calcStopLower(
    markPrice,
    await gap(o.symbol, o.botId, OrderType.FTP, 5),
    info.pricePrecision
  )
  const tpPrice = calcStopLower(
    markPrice,
    await gap(o.symbol, o.botId, OrderType.FTP, 10),
    info.pricePrecision
  )
  if (tpPrice <= 0 || stopPrice <= 0) return null
  return buildStopOrder(
    env.EXCHANGE,
    o.botId,
    o.symbol,
    OrderSide.Buy,
    OrderPositionSide.Short,
    OrderType.FTP,
    stopPrice,
    tpPrice,
    o.qty,
    o.id
  )
}
