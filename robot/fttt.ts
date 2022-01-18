// import { getHistoricalPrices, getTicker } from "../exchange/binance/futures.ts";
import { getTopVolumeGainers } from '../exchange/binance/futures.ts'
// import { Interval } from "../exchange/binance/enums.ts";
// import talib from "../talib/talib.ts";
// import { getHighsLowsCloses } from "../helper/price.ts";

async function main() {
  const list = await getTopVolumeGainers(20, 10)
  console.log(list)

  // const ticker = await getTicker('ROSEUSDT')
  // const historicalPrices = await getHistoricalPrices('FTMUSDT', Interval.D1, 30)
  // const [highs, lows, closes] = getHighsLowsCloses(historicalPrices)
  // const hma = talib.WMA(highs, 8)
  // const lma = talib.WMA(lows, 8)
  // const cma = talib.WMA(closes, 8)
  // console.log(hma.slice(-1).pop(), lma.slice(-1).pop(), cma.slice(-1).pop())
}

main()
