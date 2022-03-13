export enum Interval {
  M5 = '5m',
  M15 = '15m',
  H1 = '1h',
  H4 = '4h',
  D1 = '1d',
}

export enum Errors {
  OrderWouldImmediatelyTrigger = -2021,
  ReduceOnlyOrderIsRejected = -2022,
}
