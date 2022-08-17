import { TaValues } from '../type.ts'

interface ITrend {
  isUpSlope: () => boolean
  isDownSlope: () => boolean
}

function Trend(ta: TaValues): ITrend {
  function isUpSlope() {
    return ta.lsl_0 > 0.15 && ta.hsl_0 > 0 && ta.csl_0 > -0.1
  }

  function isDownSlope() {
    return ta.hsl_0 < -0.15 && ta.lsl_0 < 0 && ta.csl_0 < 0.1
  }

  return {
    isUpSlope,
    isDownSlope,
  }
}

export default Trend
