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

export interface CandlestickChange {
  symbol: string
  volume: number
  change: number
  time: number
}

export interface Order {
  exchange?: string
  botId?: string
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
  status: string
  openPrice: number
  orderBy: string
}>

export interface SymbolInfo {
  symbol: string
  pricePrecision: number
  qtyPrecision: number
}

export interface BookTicker {
  symbol: string
  time: number
  bestBidPrice: number
  bestBidQty: number
  bestAskPrice: number
  bestAskQty: number
}

export interface Ticker {
  symbol: string
  price: number
  time: number
}

export interface TickerAgg extends Ticker {
  qty: number
}
