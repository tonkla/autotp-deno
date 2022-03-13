import { assertEquals } from 'https://deno.land/std@0.128.0/testing/asserts.ts'
import { OrderSide } from '../consts/index.ts'
import { Candlestick } from '../types/index.ts'
import {
  calcSLStop,
  calcTPStop,
  calcStopUpper,
  calcStopLower,
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
  assertEquals(getHighestHigh(candles).high, 1.6)
  assertEquals(getLowestLow(candles).low, 1.2)
})

Deno.test('calcSLStop', () => {
  assertEquals(calcSLStop(OrderSide.Buy, 1, 40, 2), 1.4)
  assertEquals(calcSLStop(OrderSide.Buy, 1, 50, 2), 1.5)
  assertEquals(calcSLStop(OrderSide.Buy, 1, 40, 3), 1.04)
  assertEquals(calcSLStop(OrderSide.Buy, 1, 50, 3), 1.05)
  assertEquals(calcSLStop(OrderSide.Sell, 1, 40, 2), 0.6)
  assertEquals(calcSLStop(OrderSide.Sell, 1, 50, 2), 0.5)
  assertEquals(calcSLStop(OrderSide.Sell, 1, 40, 3), 0.96)
  assertEquals(calcSLStop(OrderSide.Sell, 1, 50, 3), 0.95)
})

Deno.test('calcTPStop', () => {
  assertEquals(calcTPStop(OrderSide.Buy, 1, 40, 2), 0.6)
  assertEquals(calcTPStop(OrderSide.Buy, 1, 50, 2), 0.5)
  assertEquals(calcTPStop(OrderSide.Buy, 1, 40, 3), 0.96)
  assertEquals(calcTPStop(OrderSide.Buy, 1, 50, 3), 0.95)
  assertEquals(calcTPStop(OrderSide.Sell, 1, 40, 2), 1.4)
  assertEquals(calcTPStop(OrderSide.Sell, 1, 50, 2), 1.5)
  assertEquals(calcTPStop(OrderSide.Sell, 1, 40, 3), 1.04)
  assertEquals(calcTPStop(OrderSide.Sell, 1, 50, 3), 1.05)
})

Deno.test('calcStopUpper', () => {
  assertEquals(calcStopUpper(0.21215, 40, 5), 0.21255)
})

Deno.test('calcStopLower', () => {
  assertEquals(calcStopLower(0.21215, 40, 5), 0.21175)
})
