import { PostgreSQL } from '../db/pgbf.ts'
import { bcrypt, dotenv, hono, honomd, server } from '../deps.ts'

import { encode } from '../helper/crypto.ts'

const env = dotenv.config()

const db = await new PostgreSQL().connect('', {
  database: env.DB_NAME,
  hostname: env.DB_HOST,
  port: env.DB_PORT,
  user: env.DB_USER,
  password: env.DB_PASS,
  tls: { enabled: false },
})

const app = new hono.Hono()
app.use('*', honomd.cors())
app.use('/p/*', auth)

app.post('/login', logIn)

app.get('/p/orders', getOpenOrders)
app.get('/p/pending', getPendingOrders)
app.get('/p/closed', getClosedOrders)
app.get('/p/account', getAccountInfo)

app.put('/p/orders/:id', closeOrder)
app.put('/p/pending/:id', closePendingOrder)

server.serve(app.fetch)

const RESPONSE = {
  badRequest: () =>
    new Response(JSON.stringify({ success: false, message: 'Bad Request' }), {
      status: 400,
    }),
  unauthorized: () =>
    new Response(JSON.stringify({ success: false, message: 'Unauthorized' }), {
      status: 401,
    }),
}

async function auth(c: hono.Context, next: hono.Next) {
  try {
    const a = c.req.headers.get('authorization')
    if (!a) {
      c.res = RESPONSE.unauthorized()
      return
    }

    const token = a.split('Bearer ')[1]
    if (!token) {
      c.res = RESPONSE.unauthorized()
      return
    }

    const { username, hmac } = JSON.parse(atob(token))
    if (hmac !== encode(username, env.SECRET)) {
      c.res = RESPONSE.unauthorized()
      return
    }

    await next()
  } catch {
    c.res = RESPONSE.unauthorized()
  }
}

async function logIn(c: hono.Context) {
  try {
    const { username, password } = await c.req.parseBody()
    if (!username || !password) {
      c.res = RESPONSE.badRequest()
      return
    }

    if (username !== env.USERNAME || !bcrypt.compareSync(password, env.PASSWORD)) {
      c.res = RESPONSE.badRequest()
      return
    }

    const accessToken = btoa(JSON.stringify({ username, hmac: encode(username, env.SECRET) }))
    return c.json({ accessToken })
  } catch {
    c.res = RESPONSE.badRequest()
  }
}

async function getOpenOrders(c: hono.Context) {
  const orders = await db.getAllOpenLimitOrders()
  return c.json({ orders })
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

function closeOrder(c: hono.Context) {
  // const id = c.req.param('id')
  return c.json({ success: true })
}

function closePendingOrder(c: hono.Context) {
  // const id = c.req.param('id')
  return c.json({ success: true })
}
