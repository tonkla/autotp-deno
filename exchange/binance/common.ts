import { hmac } from 'https://deno.land/x/hmac@v2.0.1/mod.ts'

import { RequestParams } from './types.ts'

export function buildQs(params: RequestParams): string {
  let qs = `timestamp=${Date.now()}&recvWindow=50000`
  for (const [k, v] of Object.entries(params)) {
    if (!['', null, undefined].includes(v)) qs += `&${k}=${v}`
  }
  return qs
}

export function sign(payload: string, secretKey: string): string {
  return hmac('sha256', secretKey, payload, 'utf8', 'hex').toString()
}
