def sumEvenSquares(n):
    return __import__("functools").reduce(lambda _a, _b: _a + _b, list(map(lambda x: x * x, list(filter(lambda x: (x % 2) == 0, list(range(1, n + 1)))))), 0)

def topN(ns, n):
    return list(reversed(sorted(ns)))[0:n]

def tagList(tags, prefix):
    return len(list(filter(lambda t: t.startswith(prefix), tags)))
