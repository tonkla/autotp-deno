import { TaValues } from '../type.ts'

interface ITrend {
  isUpSlope: () => boolean
  isDownSlope: () => boolean
  isUpCandle: () => boolean
  isDownCandle: () => boolean
}

function Trend(ta: TaValues): ITrend {
  function isUpSlope() {
    return ta.lsl_0 > 0.2 && ta.hsl_0 > 0 && ta.csl_0 > -0.1
  }

  function isDownSlope() {
    return ta.hsl_0 < -0.2 && ta.lsl_0 < 0 && ta.csl_0 < 0.1
  }

  function isUpCandle() {
    return ta.hl_0 > 0.3 && ta.hc_0 < 0.2 && ta.lsl_0 > 0.2 && ta.hsl_0 > -0.1
  }

  function isDownCandle() {
    return ta.hl_0 > 0.3 && ta.cl_0 < 0.2 && ta.hsl_0 < -0.2 && ta.lsl_0 < 0.1
  }

  return {
    isUpSlope,
    isDownSlope,
    isUpCandle,
    isDownCandle,
  }
}

export default Trend
