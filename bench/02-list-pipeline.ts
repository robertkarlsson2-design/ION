function sumEvenSquares(n: number): number {
  return Array.from({ length: n }, (_, i) => i + 1)
    .filter(x => x % 2 === 0)
    .map(x => x * x)
    .reduce((acc, x) => acc + x, 0);
}

function topN(ns: number[], n: number): number[] {
  return [...ns].sort((a, b) => b - a).slice(0, n);
}

function tagList(tags: string[], prefix: string): number {
  return tags.filter(t => t.startsWith(prefix)).length;
}
