export enum Interval {
  M1 = '1m',
  M5 = '5m',
  H1 = '1h',
  H4 = '4h',
  H8 = '8h',
  D1 = '1d',
}

export enum Errors {
  OrderWouldImmediatelyTrigger = -2021,
  ReduceOnlyOrderIsRejected = -2022,
}
