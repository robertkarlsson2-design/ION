from functools import reduce

def sum_even_squares(n: int) -> int:
    return reduce(lambda acc, x: acc + x,
                  [x * x for x in range(1, n + 1) if x % 2 == 0], 0)

def top_n(ns: list[int], n: int) -> list[int]:
    return sorted(ns, reverse=True)[:n]

def tag_list(tags: list[str], prefix: str) -> int:
    return len([t for t in tags if t.startswith(prefix)])
