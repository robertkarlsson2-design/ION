import java.util.List;
import java.util.stream.Collectors;

final class StringOps {
  public static long wordCount(String text) {
    return java.util.Arrays.stream(text.trim().split(" ")).filter(w -> !w.isEmpty()).count();
  }

  public static String capitalize(List<String> words) {
    return words.stream().map(String::toUpperCase).collect(Collectors.joining(" "));
  }

  public static String csvRow(List<String> fields) {
    return String.join(",", fields);
  }

  public static boolean hasKeyword(String text, String keyword) {
    return java.util.Arrays.stream(text.toLowerCase().split(" ")).anyMatch(w -> w.equals(keyword.toLowerCase()));
  }
}
