function total(ns) {
  return ns.reduce((acc, x) => acc + x, 0);
}

function mean(ns) {
  return total(ns) / ns.length;
}

function maximum(ns) {
  return ns.reduce((acc, x) => x > acc ? x : acc, 0);
}

function minimum(ns) {
  return ns.reduce((acc, x) => x < acc ? x : acc, 999999);
}

function countIf(ns, pred) {
  return ns.filter(pred).length;
}
