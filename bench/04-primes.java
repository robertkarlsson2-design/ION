import java.util.List;
import java.util.stream.Collectors;
import java.util.stream.LongStream;

final class Primes {
  public static boolean isPrime(long n) {
    return n > 1 && LongStream.range(2, n).allMatch(i -> n % i != 0);
  }

  public static List<Long> primesUpTo(long n) {
    return LongStream.range(2, n + 1).filter(Primes::isPrime).boxed().collect(Collectors.toList());
  }

  public static long nthPrime(long n) {
    return primesUpTo(n * 20).get(0);
  }
}
