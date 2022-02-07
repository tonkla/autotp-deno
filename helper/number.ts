export function round(input: number, precision: number) {
  const pow = Math.pow(10, precision)
  const output = Math.round(input * pow) / pow
  return isNaN(output) ? 0 : output
}

export function toNumber(input: string | number): number {
  if (typeof input === 'number') return input
  const n = Number(input)
  return isNaN(n) ? 0 : n
}
