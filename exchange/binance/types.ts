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
  openPrice?: number
  stopPrice?: number
  id?: string
  refId?: string
  limit?: number
}

export interface ResponseAccountInfo {
  feeTier: number
  canTrade: boolean
  canDeposit: boolean
  canWithdraw: boolean
  updateTime: number
  totalInitialMargin: string
  totalMaintMargin: string
  totalWalletBalance: string
  totalUnrealizedProfit: string
  totalMarginBalance: string
  totalPositionInitialMargin: string
  totalOpenOrderInitialMargin: string
  totalCrossWalletBalance: string
  totalCrossUnPnl: string
  availableBalance: string
  maxWithdrawAmount: string
  assets: {
    asset: string
    walletBalance: string
    unrealizedProfit: string
    marginBalance: string
    maintMargin: string
    initialMargin: string
    positionInitialMargin: string
    openOrderInitialMargin: string
    crossWalletBalance: string
    crossUnPnl: string
    availableBalance: string
    maxWithdrawAmount: string
    marginAvailable: boolean
    updateTime: number
  }[]
  positions: {
    symbol: string
    initialMargin: string
    maintMargin: string
    unrealizedProfit: string
    positionInitialMargin: string
    openOrderInitialMargin: string
    leverage: string
    isolated: boolean
    entryPrice: string
    maxNotional: string
    bidNotional: string
    askNotional: string
    positionSide: string
    positionAmt: string
    updateTime: number
  }[]
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

export interface ResponsePositionRisk {
  entryPrice: string
  marginType: string
  isAutoAddMargin: string
  isolatedMargin: string
  leverage: string
  liquidationPrice: string
  markPrice: string
  maxNotionalValue: string
  positionAmt: string
  symbol: string
  unRealizedProfit?: string
  unrealizedProfit?: string
  positionSide: string
  updateTime: number
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

export interface ResponseWsBookTicker {
  e: string // event type
  u: number // order book updateId
  E: number // event time
  T: number // transaction time
  s: string // symbol
  b: string // best bid price
  B: string // best bid qty
  a: string // best ask price
  A: string // best ask qty
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

export interface ResponseWsAggregateTrade {
  e: string // Event type
  E: number // Event time
  s: string // Symbol
  a: number // Aggregate trade ID
  p: string // Price
  q: string // Quantity
  f: number // First trade ID
  l: number // Last trade ID
  T: number // Trade time
  m: boolean // Is the buyer the market maker?
}

export interface ResponseWsAccountUpdate {
  e: string // Event Type 'ACCOUNT_UPDATE'
  E: number // Event Time
  T: number // Transaction
  a: // Update Data
  {
    m: string // Event reason type
    B: [
      // Balances
      {
        a: string // Asset
        wb: string // Wallet Balance
        cw: string // Cross Wallet Balance
        bc: string // Balance Change except PnL and Commission
      }
    ]
    P: [
      {
        s: string // Symbol
        pa: string // Position Amount
        ep: string // Entry Price
        cr: string // (Pre-fee) Accumulated Realized
        up: string // Unrealized PnL
        mt: string // Margin Type
        iw: string // Isolated Wallet (if isolated position)
        ps: string // Position Side
      }
    ]
  }
}

export interface ResponseWsOrderTradeUpdate {
  e: string // Event Type 'ORDER_TRADE_UPDATE'
  E: number // Event Time
  T: number // Transaction Time
  o: {
    s: string // Symbol
    c: string // Client Order Id
    S: string // Side
    o: string // Order Type
    f: string // Time in Force
    q: string // Original Quantity
    p: string // Original Price
    ap: string // Average Price
    sp: string // Stop Price. Please ignore with TRAILING_STOP_MARKET order
    x: string // Execution Type
    X: string // Order Status
    i: number // Order Id
    l: string // Order Last Filled Quantity
    z: string // Order Filled Accumulated Quantity
    L: string // Last Filled Price
    N: string // Commission Asset, will not push if no commission
    n: string // Commission, will not push if no commission
    T: number // Order Trade Time
    t: number // Trade Id
    b: string // Bids Notional
    a: string // Ask Notional
    m: boolean // Is this trade the maker side?
    R: boolean // Is this reduce only
    wt: string // Stop Price Working Type
    ot: string // Original Order Type
    ps: string // Position Side
    cp: boolean // If Close-All, pushed with conditional order
    AP: string // Activation Price, only puhed with TRAILING_STOP_MARKET order
    cr: string // Callback Rate, only puhed with TRAILING_STOP_MARKET order
    pP: boolean // ignore
    si: number // ignore
    ss: number // ignore
    rp: string // Realized Profit of the trade
  }
}

export interface ResponseSuccess {
  status: OrderStatus
  updateTime: Date
}

export interface ResponseError {
  code: number
  msg: string
}
