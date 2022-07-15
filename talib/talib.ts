export function WMA(inReal: number[], inTimePeriod: number): number[] {
  if (inTimePeriod === 1) {
    return inReal
  }

  // const outReal = new Array<number>(inReal.length)
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
  // let outIdx = startIdx
  let trailingIdx = 0
  let trailingValue = 0
  while (inIdx < inReal.length) {
    const tempReal = inReal[inIdx]
    periodSub += tempReal
    periodSub -= trailingValue
    periodSum += tempReal * inTimePeriod
    trailingValue = inReal[trailingIdx]
    // outReal[outIdx] = periodSum / divider
    outReal.push(periodSum / divider)
    periodSum -= periodSub
    inIdx++
    trailingIdx++
    // outIdx++
  }

  return outReal
}

export default {
  WMA,
}
