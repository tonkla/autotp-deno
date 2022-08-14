export enum Interval {
  M1 = '1m',
  M5 = '5m',
  M15 = '15m',
  H1 = '1h',
  H4 = '4h',
  H6 = '6h',
  H8 = '8h',
  H12 = '12h',
  D1 = '1d',
  W1 = '1w',
}

export enum Errors {
  OrderWouldImmediatelyTrigger = -2021,
  ReduceOnlyOrderIsRejected = -2022,
}
