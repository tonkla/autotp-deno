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
