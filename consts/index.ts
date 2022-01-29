export enum OrderStatus {
  New = 'NEW',
  Filled = 'FILLED',
  Canceled = 'CANCELED',
  Expired = 'EXPIRED',
  Rejected = 'REJECTED',
}

export enum OrderSide {
  Buy = 'BUY',
  Sell = 'SELL',
}

export enum OrderPositionSide {
  Long = 'LONG',
  Short = 'SHORT',
}

export enum OrderType {
  Limit = 'LIMIT',
  Market = 'MARKET',
  SSL = 'STOP_LOSS_LIMIT',
  STP = 'TAKE_PROFIT_LIMIT',
  FSL = 'STOP',
  FTP = 'TAKE_PROFIT',
}

export const RedisKeys = {
  CandlestickAll: (exchange: string, symbol: string, interval: string) =>
    `cdall-${exchange}-${symbol}-${interval}`,
  CandlestickLast: (exchange: string, symbol: string, interval: string) =>
    `cdlast-${exchange}-${symbol}-${interval}`,
  MarkPrice: (exchange: string, symbol: string) => `mark-${exchange}-${symbol}`,
  Orders: (exchange: string) => `orders-${exchange}`,
  TA: (exchange: string, symbol: string, interval: string) =>
    `ta-${exchange}-${symbol}-${interval}`,
  Ticker24hr: (exchange: string, symbol: string) => `ticker24-${exchange}-${symbol}`,
  TopGainers: (exchange: string) => `gainers-${exchange}`,
  TopLosers: (exchange: string) => `losers-${exchange}`,
}
