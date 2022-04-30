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
  unrealizedProfit: number
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

export interface TaValues {
  t_0: number
  h_0: number
  h_1: number
  h_2: number
  l_0: number
  l_1: number
  l_2: number
  c_0: number
  c_1: number
  hma_0: number
  hma_1: number
  lma_0: number
  lma_1: number
  cma_0: number
  cma_1: number
  atr: number
  slope: number
}

export interface TaValuesX {
  t_0: number
  o_0: number
  c_0: number
  hma_0: number
  hma_1: number
  lma_0: number
  lma_1: number
  cma_0: number
  cma_1: number
  atr: number
  x_9: number
  x_8: number
  x_7: number
  x_6: number
  x_5: number
  x_4: number
  x_3: number
  x_2: number
  x_1: number
}

export interface TaValuesOHLC {
  o_0: number
  h_0: number
  l_0: number
  c_0: number

  o_1: number
  h_1: number
  l_1: number
  c_1: number

  o_2: number
  h_2: number
  l_2: number
  c_2: number

  hma_0: number
  hma_1: number
  lma_0: number
  lma_1: number
  cma_0: number
  cma_1: number
  mma_0: number
  mma_1: number
  atr: number
  slope: number
  pc_0: number
  // pc_1: number
  // pc_2: number
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
