def is_prime(n: int) -> bool:
    if n <= 1:
        return False
    return all(n % i != 0 for i in range(2, n))

def primes_up_to(n: int) -> list[int]:
    return [x for x in range(2, n + 1) if is_prime(x)]

def nth_prime(n: int) -> int:
    return primes_up_to(n * 20)[0]
