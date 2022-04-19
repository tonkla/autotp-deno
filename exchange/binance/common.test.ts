import { assertEquals } from 'https://deno.land/std@0.135.0/testing/asserts.ts'
import { sign } from './common.ts'

Deno.test('sign', () => {
  const payload =
    'symbol=LTCBTC&side=BUY&type=LIMIT&timeInForce=GTC&quantity=1&price=0.1&recvWindow=5000&timestamp=1499827319559'
  const secretKey = 'NhqPtmdSJYdKjVHjA7PZj4Mge3R5YNiP1e3UZjInClVN65XAbvqqM6A7H5fATj0j'
  const expected = 'c8db56825ae71d6d79447849e617115f4a920fa2acdcab2b053c4b2838bd6b71'
  const signature = sign(payload, secretKey)
  assertEquals(signature, expected)
})
