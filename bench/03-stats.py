from functools import reduce

def total(ns: list[int]) -> int:
    return reduce(lambda acc, x: acc + x, ns, 0)

def mean(ns: list[int]) -> int:
    return total(ns) // len(ns)

def maximum(ns: list[int]) -> int:
    return reduce(lambda acc, x: x if x > acc else acc, ns, 0)

def minimum(ns: list[int]) -> int:
    return reduce(lambda acc, x: x if x < acc else acc, ns, 999999)

def count_if(ns: list[int], pred) -> int:
    return len([x for x in ns if pred(x)])
