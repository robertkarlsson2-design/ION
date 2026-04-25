def isPrime(n):
    return (n > 1) and all(map(lambda i: (n % i) != 0, list(range(2, n))))

def primesUpTo(n):
    return list(filter(isPrime, list(range(2, n + 1))))

def nthPrime(n):
    return primesUpTo(n * 20)[0]
