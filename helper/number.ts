export function toNumber(input: string | number): number {
  const n = Number(input)
  return isNaN(n) ? 0 : n
}
