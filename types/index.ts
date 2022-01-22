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

export interface Ticker {
  symbol: string
  price: number
  time: number
}
