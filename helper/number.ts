export function toNumber(input: string | number): number {
  if (typeof input === 'number') return input
  const n = Number(input)
  return isNaN(n) ? 0 : n
}
