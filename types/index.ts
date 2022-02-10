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
  id: string
  refId: string
  exchange: string
  symbol: string
  botId: string
  side: string
  positionSide: string
  type: string
  status: string
  qty: number
  zonePrice: number
  openPrice: number
  stopPrice?: number
  closePrice: number
  commission: number
  pl: number
  openOrderId: string
  closeOrderId: string
  openTime: number
  closeTime: number
  updateTime: number
}

export type QueryOrder = Partial<{
  exchange: string
  symbol: string
  botId: string
  side: string
  positionSide: string
  type: string
  status: string
  openPrice: number
}>

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
