export const RedisKeys = {
  CandlestickAll: (exchange: string, symbol: string, interval: string) =>
    `cdall-${exchange}-${symbol}-${interval}`,
  CandlestickLast: (exchange: string, symbol: string, interval: string) =>
    `cdlast-${exchange}-${symbol}-${interval}`,
  MarkPrice: (exchange: string, symbol: string) => `mark-${exchange}-${symbol}`,
  TA: (exchange: string, symbol: string, interval: string) =>
    `ta-${exchange}-${symbol}-${interval}`,
  Ticker24hr: (exchange: string, symbol: string) => `ticker24-${exchange}-${symbol}`,
  TopGainers: (exchange: string) => `gainers-${exchange}`,
  TopLosers: (exchange: string) => `losers-${exchange}`,
}
