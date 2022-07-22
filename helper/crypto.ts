import { hmac } from '../deps.ts'

export function sign(payload: string, secretKey: string): string {
  return encode(payload, secretKey)
}

export function encode(message: string, key: string): string {
  return hmac.hmac('sha256', key, message, 'utf8', 'hex').toString()
}
