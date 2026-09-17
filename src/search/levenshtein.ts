// Bounded edit distance: returns the real distance if it's <= maxDistance,
// else returns maxDistance + 1. Used for typo tolerance ("controloc" ~
// "controlock"), not for full-string fuzzy matching.
export function levenshteinBounded(a: string, b: string, maxDistance: number): number {
  if (Math.abs(a.length - b.length) > maxDistance) return maxDistance + 1
  if (a === b) return 0

  const m = a.length
  const n = b.length
  let prev = new Array(n + 1)
  let curr = new Array(n + 1)
  for (let j = 0; j <= n; j++) prev[j] = j

  for (let i = 1; i <= m; i++) {
    curr[0] = i
    let rowMin = curr[0]
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost)
      if (curr[j] < rowMin) rowMin = curr[j]
    }
    if (rowMin > maxDistance) return maxDistance + 1
    ;[prev, curr] = [curr, prev]
  }

  return prev[n]
}
