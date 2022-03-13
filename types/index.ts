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

export interface PositionRisk {
  symbol: string
  entryPrice: number
  marginType?: string
  isAutoAddMargin?: string
  isolatedMargin?: number
  leverage?: number
  liquidationPrice?: number
  markPrice?: number
  maxNotionalValue?: number
  positionAmt: number
  unrealizedProfit?: number
  positionSide: string
  updateTime: number
}

export interface BookTicker {
  symbol: string
  time: number
  bestBidPrice: number
  bestBidQty: number
  bestAskPrice: number
  bestAskQty: number
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

export interface PriceMovement {
  h24: TfPrice
  utc: TfPrice
  h8: TfPrice
  h4: TfPrice
  h2: TfPrice
  h1: TfPrice
  m30: TfPrice
  m15: TfPrice
  m5: TfPrice
}

export interface SymbolInfo {
  symbol: string
  pricePrecision: number
  qtyPrecision: number
}

export interface TaValues {
  openTime: number
  closeTime: number
  h_0: number
  h_1: number
  h_2: number
  l_0: number
  l_1: number
  l_2: number
  c_0: number
  c_1: number
  c_2: number
  hma_0: number
  hma_1: number
  lma_0: number
  lma_1: number
  cma_0: number
  cma_1: number
  atr: number
  slope: number
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
  open: number
  high: number
  low: number
  pcAtr: number
  pcHL: number
}
