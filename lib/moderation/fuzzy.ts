import { distance } from "fastest-levenshtein";

/**
 * Normalized similarity in [0, 1]: 1 for identical strings, 0 for maximally
 * different. Two empty strings are treated as identical (1), not divided by
 * zero.
 */
export function similarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - distance(a, b) / maxLen;
}
