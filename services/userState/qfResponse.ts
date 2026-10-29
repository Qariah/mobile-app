// @ai
/**
 * The list unwrap that the QF resource modules share (divergence batch C3,
 * SEM-S9; before, each module had its own copy).
 *
 * The SDK types most responses as `unknown`, and QF wraps a list in a key
 * that changes with the endpoint and the API version.
 *
 * Returns `res` when it is an array. Else returns the value of the first key
 * in `keys` that is not `null` or `undefined` (the same order as
 * `r.a ?? r.b ?? []`). Else returns an empty array.
 */
export function unwrapQfList<T>(res: unknown, keys: readonly string[]): T[] {
  if (Array.isArray(res)) return res as T[];
  if (res && typeof res === 'object') {
    for (const key of keys) {
      const value = (res as Record<string, unknown>)[key];
      if (value !== undefined && value !== null) return value as T[];
    }
  }
  return [];
}
