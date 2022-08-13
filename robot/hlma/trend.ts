import { TaValues } from '../type.ts'

interface ITrend {
  isUpSlope: () => boolean
  isDownSlope: () => boolean
  isUpCandle: () => boolean
  isDownCandle: () => boolean
  isTurnOverCandle: () => boolean
}

function Trend(ta: TaValues): ITrend {
  function isUpSlope() {
    return ta.lsl_0 > 0.1 && ta.hsl_0 > 0 && ta.csl_0 > -0.1
  }

  function isDownSlope() {
    return ta.hsl_0 < -0.1 && ta.lsl_0 < 0 && ta.csl_0 < 0.1
  }

  function isUpCandle() {
    return ta.hc_0 < 0.2 && (ta.co_0 > 0 || ta.hl_0 > 0.5)
  }

  function isDownCandle() {
    return ta.cl_0 < 0.2 && (ta.co_0 < 0 || ta.hl_0 > 0.5)
  }

  function isTurnOverCandle() {
    return ta.hl_0 > 0.6 && ((ta.co_0 > 0.1 && ta.cl_0 < 0.1) || (ta.co_0 < -0.1 && ta.hc_0 < 0.1))
  }

  return {
    isUpSlope,
    isDownSlope,
    isUpCandle,
    isDownCandle,
    isTurnOverCandle,
  }
}

export default Trend
