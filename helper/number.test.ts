import { assertEquals } from 'https://deno.land/std@0.128.0/testing/asserts.ts'
import { round, toNumber } from './number.ts'

Deno.test('toNumber', () => {
  assertEquals(toNumber(1), 1)
  assertEquals(toNumber('1'), 1)
  assertEquals(toNumber(''), 0)
})

Deno.test('round', () => {
  assertEquals(round(1.4, 0), 1)
  assertEquals(round(1.5, 0), 2)
  assertEquals(round(1.4, 1), 1.4)
  assertEquals(round(1.5, 1), 1.5)
  assertEquals(round(1.41, 2), 1.41)
  assertEquals(round(1.45, 2), 1.45)
  assertEquals(round(1.444, 2), 1.44)
  assertEquals(round(1.445, 2), 1.45)
})
