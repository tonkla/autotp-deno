export enum Interval {
  D1 = '1d',
  H4 = '4h',
  H1 = '1h',
  M15 = '15m',
  M5 = '5m',
  M1 = '1m',
}

export enum Errors {
  OrderWouldImmediatelyTrigger = -2021,
  ReduceOnlyOrderIsRejected = -2022,
}
