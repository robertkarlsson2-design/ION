final class Fibonacci {
  public static long fib(long n) {
    return n <= 1 ? n : fib(n - 1) + fib(n - 2);
  }
}
