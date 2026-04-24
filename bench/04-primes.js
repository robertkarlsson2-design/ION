function isPrime(n) {
  if (n <= 1) return false;
  return Array.from({ length: n - 2 }, (_, i) => i + 2)
    .every(i => n % i !== 0);
}

function primesUpTo(n) {
  return Array.from({ length: n - 1 }, (_, i) => i + 2)
    .filter(x => isPrime(x));
}

function nthPrime(n) {
  return primesUpTo(n * 20).reduce((acc, x) => acc === 0 ? x : acc, 0);
}
