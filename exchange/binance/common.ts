import { hmac } from 'https://deno.land/x/hmac@v2.0.1/mod.ts'

import { RequestParams } from './types.ts'

export function buildPostQs(params: RequestParams): string {
  const mapKeys: { [key: string]: string } = {
    id: 'newClientOrderId',
    qty: 'quantity',
    openPrice: 'price',
  }
  let qs = `recvWindow=10000&timestamp=${Date.now()}&timeInForce=GTC`
  for (const [k, v] of Object.entries(params)) {
    if (!['', 0, null, undefined].includes(v)) {
      const _k = mapKeys[k]
      qs += _k ? `&${_k}=${v}` : `&${k}=${v}`
    }
  }
  return qs
}

export function buildGetQs(params: RequestParams): string {
  const mapKeys: { [key: string]: string } = {
    id: 'origClientOrderId',
    refId: 'orderId',
  }
  let qs = `recvWindow=10000&timestamp=${Date.now()}`
  for (const [k, v] of Object.entries(params)) {
    if (!['', 0, null, undefined].includes(v)) {
      const _k = mapKeys[k]
      qs += _k ? `&${_k}=${v}` : `&${k}=${v}`
    }
  }
  return qs
}

export function sign(payload: string, secretKey: string): string {
  return hmac('sha256', secretKey, payload, 'utf8', 'hex').toString()
}
