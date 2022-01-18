import { HistoricalPrice, HistoricalPriceChange, Ticker } from '../../types/index.ts'
import { toNumber } from '../../helper/number.ts'
import { Response24hrTicker } from './types.ts'

const baseUrl = 'https://fapi.binance.com'

export async function getHistoricalPrices(
  symbol: string,
  interval: string,
  limit: number
): Promise<HistoricalPrice[]> {
  try {
    const url = `${baseUrl}/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`
    const res = await fetch(url)
    const data = await res.json()
    if (!Array.isArray(data)) return []
    return data.map((d: string[]) => ({
      symbol,
      time: toNumber(d[0]),
      open: toNumber(d[1]),
      high: toNumber(d[2]),
      low: toNumber(d[3]),
      close: toNumber(d[4]),
      volume: toNumber(d[5]),
      change: 0,
    }))
  } catch {
    return []
  }
}

export async function getTicker(symbol: string): Promise<Ticker | null> {
  try {
    const url = `${baseUrl}/fapi/v1/ticker/price?symbol=${symbol}`
    const res = await fetch(url)
    const { price, time }: Ticker = await res.json()
    return {
      symbol,
      price: Number(price),
      time,
    }
  } catch {
    return null
  }
}

export async function getTicker24hr(): Promise<HistoricalPrice[]> {
  try {
    const url = `${baseUrl}/fapi/v1/ticker/24hr`
    const res = await fetch(url)
    const data: Response24hrTicker[] = await res.json()
    if (!Array.isArray(data)) return []
    return data.map((d) => ({
      symbol: d.symbol,
      time: d.openTime,
      open: toNumber(d.openPrice),
      high: toNumber(d.highPrice),
      low: toNumber(d.lowPrice),
      close: toNumber(d.lastPrice),
      volume: toNumber(d.quoteVolume),
      change: toNumber(d.priceChangePercent),
    }))
  } catch {
    return []
  }
}

export async function getTicker24hrChanges(): Promise<HistoricalPriceChange[]> {
  try {
    const url = `${baseUrl}/fapi/v1/ticker/24hr`
    const res = await fetch(url)
    const data: Response24hrTicker[] = await res.json()
    if (!Array.isArray(data)) return []
    return data.map((d) => ({
      symbol: d.symbol,
      volume: toNumber(d.quoteVolume),
      change: toNumber(d.priceChangePercent),
    }))
  } catch {
    return []
  }
}

export async function getTopGainers(n: number): Promise<HistoricalPriceChange[]> {
  try {
    const data = await getTicker24hrChanges()
    return data
      .filter((d) => d.symbol.indexOf('USDT') > 0)
      .sort((a, b) => (Number(a.change) < Number(b.change) ? 1 : -1))
      .slice(0, n)
  } catch {
    return []
  }
}

export async function getTopLosers(n: number): Promise<HistoricalPriceChange[]> {
  try {
    const data = await getTicker24hrChanges()
    return data
      .filter((d) => d.symbol.indexOf('USDT') > 0)
      .sort((a, b) => (Number(a.change) > Number(b.change) ? 1 : -1))
      .slice(0, n)
  } catch {
    return []
  }
}

export async function getTopVolumes(n: number): Promise<HistoricalPriceChange[]> {
  try {
    const data = await getTicker24hrChanges()
    return data
      .filter((d) => d.symbol.indexOf('USDT') > 0)
      .sort((a, b) => (Number(a.volume) < Number(b.volume) ? 1 : -1))
      .slice(0, n)
  } catch {
    return []
  }
}

export async function getTopVolumeGainers(
  top: number,
  n: number
): Promise<HistoricalPriceChange[]> {
  try {
    const data = await getTopVolumes(top)
    return data.sort((a, b) => (Number(a.change) < Number(b.change) ? 1 : -1)).slice(0, n)
  } catch {
    return []
  }
}

export async function getTopVolumeLosers(top: number, n: number): Promise<HistoricalPriceChange[]> {
  try {
    const data = await getTopVolumes(top)
    return data.sort((a, b) => (Number(a.change) > Number(b.change) ? 1 : -1)).slice(0, n)
  } catch {
    return []
  }
}

export default {
  getHistoricalPrices,
  getTicker,
  getTicker24hr,
  getTicker24hrChanges,
  getTopGainers,
  getTopLosers,
  getTopVolumes,
  getTopVolumeGainers,
  getTopVolumeLosers,
}
