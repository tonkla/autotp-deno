import { getBookTicker } from '../../exchange/binance/futures.ts'
import { SymbolInfo } from '../../types/index.ts'

function countPrecision(n: number): number {
  const p = n.toString().split('.')[1]
  return p === undefined ? 0 : p.length
}

export async function getSymbolInfo(symbol: string): Promise<SymbolInfo | null> {
  try {
    const bt = await getBookTicker(symbol)
    if (!bt) return null

    const q1 = countPrecision(bt.bestBidQty)
    const q2 = countPrecision(bt.bestAskQty)
    const qtyPrecision = q1 > q2 ? q1 : q2

    return { symbol, qtyPrecision, pricePrecision: 0 }
  } catch {
    return null
  }
}
