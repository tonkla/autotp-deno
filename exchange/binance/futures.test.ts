import { assertEquals } from 'https://deno.land/std@0.122.0/testing/asserts.ts'
import { getSymbolInfo } from './futures.ts'

Deno.test('getSymbolInfo', async () => {
  const info = await getSymbolInfo('BTCUSDT')
  assertEquals(info?.pricePrecision, 2)
  assertEquals(info?.qtyPrecision, 3)
})
