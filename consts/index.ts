export const RedisKeys = {
  CandlestickAll: (exchange: string, symbol: string, interval: string) =>
    `candle-${exchange}-${symbol}-${interval}-all`,
  CandlestickLast: (exchange: string, symbol: string, interval: string) =>
    `candle-${exchange}-${symbol}-${interval}-last`,
  Order: (exchange: string, symbol: string, botId: number) =>
    `order-${exchange}-${symbol}-${botId}`,
  TA: (exchange: string, symbol: string, interval: string) =>
    `ta-${exchange}-${symbol}-${interval}`,
  Ticker24hr: (exchange: string, symbol: string) => `ticker24-${exchange}-${symbol}`,
  TopGainers: (exchange: string) => `gainers-${exchange}`,
  TopLosers: (exchange: string) => `losers-${exchange}`,
}
