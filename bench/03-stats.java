import java.util.List;
import java.util.function.Predicate;

final class Stats {
  public static long total(List<Long> ns) {
    return ns.stream().mapToLong(Long::longValue).sum();
  }

  public static long mean(List<Long> ns) {
    return total(ns) / ns.size();
  }

  public static long maximum(List<Long> ns) {
    return ns.stream().mapToLong(Long::longValue).max().orElse(0);
  }

  public static long minimum(List<Long> ns) {
    return ns.stream().mapToLong(Long::longValue).min().orElse(999999);
  }

  public static long countIf(List<Long> ns, Predicate<Long> p) {
    return ns.stream().filter(p).count();
  }
}
