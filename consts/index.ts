export enum OrderStatus {
  New = 'NEW',
  Filled = 'FILLED',
  PartiallyFilled = 'PARTIALLY_FILLED',
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
