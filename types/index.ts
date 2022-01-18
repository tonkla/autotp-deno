export interface HistoricalPrice {
  symbol: string
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
  change: number
}

export interface HistoricalPriceChange {
  symbol: string
  volume: number
  change: number
}

export interface Ticker {
  symbol: string
  price: number
  time: number
}
