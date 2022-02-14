export type OrderPositionSide = 'LONG' | 'SHORT' | 'BOTH'
export type OrderSide = 'BUY' | 'SELL'
export type OrderStatus =
  | 'NEW'
  | 'PARTIALLY_FILLED'
  | 'FILLED'
  | 'CANCELED'
  | 'REJECTED'
  | 'EXPIRED'
export type OrderType =
  | 'LIMIT'
  | 'MARKET'
  | 'STOP'
  | 'STOP_MARKET'
  | 'TAKE_PROFIT'
  | 'TAKE_PROFIT_MARKET'
  | 'TRAILING_STOP_MARKET'
export type OrderTimeInForce = 'GTC' | 'IOC' | 'FOK' | 'GTX'
export type OrderWorkingType = 'MARK_PRICE' | 'CONTRACT_PRICE'

export interface RequestParams {
  symbol: string
  side?: string
  positionSide?: string
  type?: string
  qty?: number
  price?: number
  id?: string
  refId?: string
  limit?: number
}

export interface Response24hrTicker {
  symbol: string
  priceChange: string
  priceChangePercent: string
  weightedAvgPrice: string
  lastPrice: string
  lastQty: string
  openPrice: string
  highPrice: string
  lowPrice: string
  volume: string
  quoteVolume: string
  openTime: number
  closeTime: number
  firstId: number
  lastId: number
  count: number
}

export interface ResponseNewOrder {
  clientOrderId: string
  cumQty: string
  cumQuote: string
  executedQty: string
  orderId: number
  avgPrice: string
  origQty: string
  price: string
  reduceOnly: boolean
  side: OrderSide
  positionSide: OrderPositionSide
  status: OrderStatus
  stopPrice: string
  closePosition: boolean
  symbol: string
  timeInForce: OrderTimeInForce
  type: OrderType
  origType: OrderType
  activatePrice: string
  priceRate: string
  updateTime: number
  workingType: OrderWorkingType
  priceProtect: boolean
}

export interface ResponseOrderStatus {
  avgPrice: string
  clientOrderId: string
  cumQuote: string
  executedQty: string
  orderId: number
  origQty: string
  origType: string
  price: string
  reduceOnly: boolean
  side: OrderSide
  positionSide: OrderPositionSide
  status: OrderStatus
  stopPrice: string
  closePosition: boolean
  symbol: string
  time: number
  timeInForce: OrderTimeInForce
  type: OrderType
  activatePrice: string
  priceRate: string
  updateTime: number
  workingType: OrderWorkingType
  priceProtect: boolean
}

export interface ResponseTradesList {
  buyer: boolean
  commission: string
  commissionAsset: string
  id: number
  maker: boolean
  orderId: number
  price: string
  qty: string
  quoteQty: string
  realizedPnl: string
  side: string
  positionSide: string
  symbol: string
  time: number
}

export interface ResponseWs24hrTicker {
  e: string // Event type
  E: number // Event time
  s: string // Symbol
  p: string // Price change
  P: string // Price change percent
  w: string // Weighted average price
  c: string // Last price
  Q: string // Last quantity
  o: string // Open price
  h: string // High price
  l: string // Low price
  v: string // Total traded base asset volume
  q: string // Total traded quote asset volume
  O: number // Statistics open time
  C: number // Statistics close time
  F: number // First trade ID
  L: number // Last trade Id
  n: number // Total number of trades
}

export interface ResponseWsCandlestick {
  e: string // Event type
  E: number // Event time
  s: string // Symbol
  k: {
    t: number // Kline start time
    T: number // Kline close time
    s: string // Symbol
    i: string // Interval
    f: number // First trade ID
    L: number // Last trade ID
    o: string // Open price
    c: string // Close price
    h: string // High price
    l: string // Low price
    v: string // Base asset volume
    n: number // Number of trades
    x: boolean // Is this kline closed?
    q: string // Quote asset volume
    V: string // Taker buy base asset volume
    Q: string // Taker buy quote asset volume
    B: string // Ignore
  }
}

export interface ResponseWsMarkPrice {
  e: string // Event type
  E: number // Event time
  s: string // Symbol
  p: string // Mark price
  i: string // Index price
  P: string // Estimated Settle Price, only useful in the last hour before the settlement starts
  r: string // Funding rate
  T: number // Next funding time
}

export interface ResponseSuccess {
  status: OrderStatus
  updateTime: Date
}

export interface ResponseError {
  code: number
  msg: string
}
