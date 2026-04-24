function isPrime(n: number): boolean {
  if (n <= 1) return false;
  return Array.from({ length: n - 2 }, (_, i) => i + 2)
    .every(i => n % i !== 0);
}

function primesUpTo(n: number): number[] {
  return Array.from({ length: n - 1 }, (_, i) => i + 2)
    .filter(x => isPrime(x));
}

function nthPrime(n: number): number {
  return primesUpTo(n * 20).reduce((acc, x) => acc === 0 ? x : acc, 0);
}
