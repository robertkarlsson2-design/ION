function sumEvenSquares(n) {
  return Array.from({ length: n }, (_, i) => i + 1)
    .filter(x => x % 2 === 0)
    .map(x => x * x)
    .reduce((acc, x) => acc + x, 0);
}

function topN(ns, n) {
  return [...ns].reverse().slice(0, n);
}

function frequencies(tags) {
  return tags.map(t => t + ": ");
}
