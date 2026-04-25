def total(ns):
    return __import__("functools").reduce(lambda _a, _b: _a + _b, ns, 0)

def mean(ns):
    return total(ns) / len(ns)

def maximum(ns):
    return __import__("functools").reduce(lambda acc, x: x if x > acc else acc, ns, 0)

def minimum(ns):
    return __import__("functools").reduce(lambda acc, x: x if x < acc else acc, ns, 999999)

def countIf(ns, pred):
    return len(list(filter(pred, ns)))
