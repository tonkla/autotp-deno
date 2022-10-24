// Credits: https://github.com/markcheno/go-talib

function EMAx(inReal: number[], inTimePeriod: number, multiplier: number): number[] {
  if (inTimePeriod === 1) {
    return inReal
  }

  const outReal = new Array<number>(inReal.length)

  const startIdx = inTimePeriod - 1

  let tempReal = 0
  let today = 0
  let i = inTimePeriod
  while (i > 0) {
    tempReal += inReal[today] ?? 0
    today++
    i--
  }

  let prevMA = tempReal / inTimePeriod
  while (today <= startIdx) {
    prevMA = ((inReal[today] ?? 0) - prevMA) * multiplier + prevMA
    today++
  }

  outReal[startIdx] = prevMA

  let outIdx = inTimePeriod
  while (today < inReal.length) {
    prevMA = ((inReal[today] ?? 0) - prevMA) * multiplier + prevMA
    outReal[outIdx] = prevMA
    today++
    outIdx++
  }

  return outReal
}

export function EMA(inREal: number[], inTimePeriod: number): number[] {
  const multiplier = 2.0 / (inTimePeriod + 1)
  return EMAx(inREal, inTimePeriod, multiplier)
}

export function WMA(inReal: number[], inTimePeriod: number): number[] {
  if (inTimePeriod === 1) {
    return inReal
  }

  const outReal = []

  const startIdx = inTimePeriod - 1

  let periodSub = 0
  let periodSum = 0
  let inIdx = 0
  let i = 1
  while (inIdx < startIdx) {
    const tempReal = inReal[inIdx]
    periodSub += tempReal
    periodSum += tempReal * i
    inIdx++
    i++
  }

  const divider = (inTimePeriod * (inTimePeriod + 1)) >> 1
  let trailingIdx = 0
  let trailingValue = 0
  while (inIdx < inReal.length) {
    const tempReal = inReal[inIdx]
    periodSub += tempReal
    periodSub -= trailingValue
    periodSum += tempReal * inTimePeriod
    trailingValue = inReal[trailingIdx]
    outReal.push(periodSum / divider)
    periodSum -= periodSub
    inIdx++
    trailingIdx++
  }

  return outReal
}

export function MACD(
  inReal: number[],
  inFastPeriod: number,
  inSlowPeriod: number,
  inSignalPeriod: number
): number[][] {
  if (inSlowPeriod < inFastPeriod) {
    // deno-lint-ignore no-extra-semi
    ;[inFastPeriod, inSlowPeriod] = [inSlowPeriod, inFastPeriod]
  }

  let mFast = 0
  if (inFastPeriod > 0) {
    mFast = 2 / (inFastPeriod + 1)
  } else {
    inFastPeriod = 12
    mFast = 0.15
  }

  let mSlow = 0
  if (inSlowPeriod > 0) {
    mSlow = 2 / (inSlowPeriod + 1)
  } else {
    inSlowPeriod = 26
    mSlow = 0.075
  }

  const lookbackTotal = inSignalPeriod - 1 + (inSlowPeriod - 1)

  const outMACD = new Array<number>(inReal.length)
  const outMACDHist = new Array<number>(inReal.length)

  const fastEMABuffer = EMAx(inReal, inFastPeriod, mFast)
  const slowEMABuffer = EMAx(inReal, inSlowPeriod, mSlow)

  let _f = 0
  let _s = 0
  for (let i = lookbackTotal - 1; i < inReal.length; i++) {
    _f = fastEMABuffer[i]
    _s = slowEMABuffer[i]
    if (isNaN(_f) || isNaN(_s)) continue
    outMACD[i] = _f - _s
  }

  const outMACDSignal = EMAx(outMACD, inSignalPeriod, 2 / (inSignalPeriod + 1))

  for (let i = lookbackTotal; i < inReal.length; i++) {
    outMACDHist[i] = outMACD[i] - outMACDSignal[i]
  }

  return [outMACD, outMACDSignal, outMACDHist]
}
