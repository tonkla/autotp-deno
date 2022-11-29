import type { PostgreSQL } from '../db/pgbf.ts'
import type { Redis } from '../db/redis.ts'
import type { PrivateApi } from '../exchange/binance/futures.ts'

export interface AccountInfo {
  totalMarginBalance: number
  totalWalletBalance: number
  totalUnrealizedProfit: number
}

export interface AccountPosition {
  symbol: string
  positionAmt: number
  entryPrice: number
  realizedPnL: number
  unrealizedPnL: number
  marginType: string
  isolatedWallet: number
  positionSide: string
}

export interface BotProps {
  symbols: string[]
  db: PostgreSQL
  redis: Redis
  exchange: PrivateApi
}

export type BotFunc = (p: BotProps) => Promise<{
  createLongLimit(): void
  createShortLimit(): void
  createLongStop(): void
  createShortStop(): void
  cancelTimedOut(): void
  closeOrphan(): void
}>

export interface BotClass {
  createLongLimit(): void
  createShortLimit(): void
  createLongStop(): void
  createShortStop(): void
  cancelTimedOutOrder(): void
  closeOrphanOrder(): void
}

export interface PositionRisk {
  symbol: string
  entryPrice: number
  marginType?: string
  isAutoAddMargin?: string
  isolatedMargin?: number
  leverage?: number
  liquidationPrice?: number
  markPrice: number
  maxNotionalValue?: number
  positionAmt: number
  unrealizedProfit: number
  positionSide: string
  updateTime: number
}

export interface BookDepth {
  symbol: string
  time: number
  asks: number[][]
  bids: number[][]
  spread: number
}

export interface BookTicker {
  symbol: string
  time: number
  bestAskPrice: number
  bestAskQty: number
  bestBidPrice: number
  bestBidQty: number
  spread: number
}

export interface Candlestick {
  symbol: string
  openTime: number
  closeTime: number
  open: number
  high: number
  low: number
  close: number
  volume: number
  change: number
  time: number
}

export interface OHLC {
  o: number
  h: number
  l: number
  c: number
}

export interface Order {
  exchange?: string
  botId: string
  symbol: string
  id: string
  refId: string
  side: string
  positionSide?: string
  type: string
  status: string
  qty: number
  zonePrice?: number
  openPrice: number
  stopPrice?: number
  closePrice: number
  commission: number
  commissionAsset?: string
  pl: number
  maxPip?: number
  maxProfit?: number
  note?: string
  openOrderId?: string
  closeOrderId?: string
  openTime?: Date
  closeTime?: Date
  updateTime?: Date
}

export type QueryOrder = Partial<{
  exchange: string
  botId: string
  symbol: string
  side: string
  positionSide: string
  type: string
  types: string[]
  status: string
  openPrice: number
  orderBy: string
}>

export interface PriceChange {
  h24?: TfPrice
  utc?: TfPrice
  h8?: TfPrice
  h6?: TfPrice
  h4?: TfPrice
  h2?: TfPrice
  h1: TfPrice
  m30?: TfPrice
  m15?: TfPrice
}

export interface SymbolInfo {
  symbol: string
  pricePrecision: number
  qtyPrecision: number
}

export interface Ticker {
  symbol: string
  price: number
  time: number
}

export interface TickerAgg extends Ticker {
  qty: number
}

export interface TfPrice {
  open?: number
  high: number
  low: number
  pcAtr?: number
  pcHL: number
}
