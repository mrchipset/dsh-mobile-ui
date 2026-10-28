import { timingSafeEqual } from 'node:crypto'

/** Constant-time token comparison; length mismatch is an immediate miss. */
export function verifyToken(candidate: string, expected: string): boolean {
  const left = Buffer.from(candidate, 'utf8')
  const right = Buffer.from(expected, 'utf8')
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}
