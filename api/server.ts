import { bcrypt, hono, server } from '../deps.ts'

import { encode } from '../helper/crypto.ts'

const app = new hono.Hono()
app.use('/p/*', auth)
app.post('/login', logIn)
app.get('/p/orders', getOrders)
server.serve(app.fetch)

const SECRET = 'GBFN5ve8sJqfbWGKKEuDpu0xtbhE9Nhg'
const USERNAME = '$2a$10$JZRz4U/TE4o85tH7RV7avenTbP17EHZywyj4VbtCy7MlDWHIrzRQq'
const PASSWORD = '$2a$10$fzRcjn67GeWovrbEHH.X.O0BhQXhV5ChFmaKnck.4Msr58NSG3sdS'

async function auth(c: hono.Context, next: hono.Next) {
  try {
    const a = c.req.headers.get('authorization')
    if (!a) {
      c.res = new Response('Unauthorized', { status: 401 })
      return
    }

    const token = a.split('Bearer ')[1]
    if (!token) {
      c.res = new Response('Unauthorized', { status: 401 })
      return
    }

    const { username, hmac } = JSON.parse(atob(token))
    if (hmac !== encode(username, SECRET)) {
      c.res = new Response('Unauthorized', { status: 401 })
      return
    }

    await next()
  } catch {
    c.res = new Response('Bad Request', { status: 400 })
  }
}

async function logIn(c: hono.Context) {
  try {
    const { username, password } = await c.req.parseBody()
    if (!username || !password) {
      c.res = new Response('Bad Request', { status: 400 })
      return
    }

    const usr = bcrypt.compareSync(username, USERNAME)
    const pwd = bcrypt.compareSync(password, PASSWORD)
    if (!usr || !pwd) {
      c.res = new Response('Bad Request', { status: 400 })
      return
    }

    const accessToken = btoa(JSON.stringify({ username, hmac: encode(username, SECRET) }))
    return c.json({ accessToken })
  } catch {
    c.res = new Response('Bad Request', { status: 400 })
  }
}

function getOrders(c: hono.Context) {
  return c.json({ orders: [{ id: '1234' }] })
}
