export function round(input: number, precision: number) {
  const pow = Math.pow(10, precision)
  return Math.round(input * pow) / pow
}

export function toNumber(input: string | number): number {
  if (typeof input === 'number') return input
  const n = Number(input)
  return isNaN(n) ? 0 : n
}
