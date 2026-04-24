function isPrime(n) {
  if (n <= 1) return false;
  for (let i = 2; i < n; i++) {
    if (n % i === 0) return false;
  }
  return true;
}

function primesUpTo(n) {
  const result = [];
  for (let i = 2; i <= n; i++) {
    if (isPrime(i)) result.push(i);
  }
  return result;
}

function nthPrime(n) {
  const primes = primesUpTo(n * 20);
  return primes[n - 1];
}
