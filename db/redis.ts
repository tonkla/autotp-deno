import { Redis } from 'https://deno.land/x/redis@v0.25.2/mod.ts'

import { RedisKeys } from '../consts/index.ts'
import { SymbolInfo } from '../types/index.ts'

export async function getSymbolInfo(
  redis: Redis,
  exchange: string,
  symbol: string
): Promise<SymbolInfo | null> {
  const _infos = await redis.get(RedisKeys.Symbols(exchange))
  if (!_infos) return null
  const infos: SymbolInfo[] = JSON.parse(_infos).map((s: (string | number)[]) => ({
    symbol: s[0],
    pricePrecision: s[1],
    qtyPrecision: s[2],
  }))
  if (Array.isArray(infos)) {
    return infos.find((i) => i.symbol === symbol) ?? null
  }
  return null
}
