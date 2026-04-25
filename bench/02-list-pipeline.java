import java.util.List;
import java.util.stream.Collectors;
import java.util.stream.LongStream;

final class ListPipeline {
  public static long sumEvenSquares(long n) {
    return LongStream.range(1, n + 1).filter(x -> x % 2 == 0).map(x -> x * x).sum();
  }

  public static List<Long> topN(List<Long> ns, int n) {
    return ns.stream().sorted((a, b) -> Long.compare(b, a)).limit(n).collect(Collectors.toList());
  }

  public static long tagList(List<String> tags, String prefix) {
    return tags.stream().filter(t -> t.startsWith(prefix)).count();
  }
}
