import { testing } from '../deps.ts'

import { round, toNumber } from './number.ts'

Deno.test('toNumber', () => {
  testing.assertEquals(toNumber(1), 1)
  testing.assertEquals(toNumber('1'), 1)
  testing.assertEquals(toNumber(''), 0)
})

Deno.test('round', () => {
  testing.assertEquals(round(1.4, 0), 1)
  testing.assertEquals(round(1.5, 0), 2)
  testing.assertEquals(round(1.4, 1), 1.4)
  testing.assertEquals(round(1.5, 1), 1.5)
  testing.assertEquals(round(1.41, 2), 1.41)
  testing.assertEquals(round(1.45, 2), 1.45)
  testing.assertEquals(round(1.444, 2), 1.44)
  testing.assertEquals(round(1.445, 2), 1.45)
})
