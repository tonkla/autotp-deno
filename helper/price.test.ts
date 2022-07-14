import { testing } from '../deps.ts'

import { OrderSide } from '../consts/index.ts'
import { Candlestick } from '../types/index.ts'
import {
  calcSLStop,
  calcStopLower,
  calcStopUpper,
  calcTPStop,
  getHighestHigh,
  getLowestLow,
} from './price.ts'

Deno.test('getHighestLowest', () => {
  const candles: Candlestick[] = [
    {
      symbol: '',
      openTime: 0,
      closeTime: 0,
      open: 0,
      high: 1.5,
      low: 1.2,
      close: 0,
      volume: 0,
      change: 0,
      time: 0,
    },
    {
      symbol: '',
      openTime: 0,
      closeTime: 0,
      open: 0,
      high: 1.6,
      low: 1.3,
      close: 0,
      volume: 0,
      change: 0,
      time: 0,
    },
  ]
  testing.assertEquals(getHighestHigh(candles).high, 1.6)
  testing.assertEquals(getLowestLow(candles).low, 1.2)
})

Deno.test('calcSLStop', () => {
  testing.assertEquals(calcSLStop(OrderSide.Buy, 1, 40, 2), 1.4)
  testing.assertEquals(calcSLStop(OrderSide.Buy, 1, 50, 2), 1.5)
  testing.assertEquals(calcSLStop(OrderSide.Buy, 1, 40, 3), 1.04)
  testing.assertEquals(calcSLStop(OrderSide.Buy, 1, 50, 3), 1.05)
  testing.assertEquals(calcSLStop(OrderSide.Sell, 1, 40, 2), 0.6)
  testing.assertEquals(calcSLStop(OrderSide.Sell, 1, 50, 2), 0.5)
  testing.assertEquals(calcSLStop(OrderSide.Sell, 1, 40, 3), 0.96)
  testing.assertEquals(calcSLStop(OrderSide.Sell, 1, 50, 3), 0.95)
})

Deno.test('calcTPStop', () => {
  testing.assertEquals(calcTPStop(OrderSide.Buy, 1, 40, 2), 0.6)
  testing.assertEquals(calcTPStop(OrderSide.Buy, 1, 50, 2), 0.5)
  testing.assertEquals(calcTPStop(OrderSide.Buy, 1, 40, 3), 0.96)
  testing.assertEquals(calcTPStop(OrderSide.Buy, 1, 50, 3), 0.95)
  testing.assertEquals(calcTPStop(OrderSide.Sell, 1, 40, 2), 1.4)
  testing.assertEquals(calcTPStop(OrderSide.Sell, 1, 50, 2), 1.5)
  testing.assertEquals(calcTPStop(OrderSide.Sell, 1, 40, 3), 1.04)
  testing.assertEquals(calcTPStop(OrderSide.Sell, 1, 50, 3), 1.05)
})

Deno.test('calcStopUpper', () => {
  testing.assertEquals(calcStopUpper(0.21215, 40, 5), 0.21255)
})

Deno.test('calcStopLower', () => {
  testing.assertEquals(calcStopLower(0.21215, 40, 5), 0.21175)
})
