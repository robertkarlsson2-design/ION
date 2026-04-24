function total(ns: number[]): number {
  return ns.reduce((acc, x) => acc + x, 0);
}

function mean(ns: number[]): number {
  return total(ns) / ns.length;
}

function maximum(ns: number[]): number {
  return ns.reduce((acc, x) => x > acc ? x : acc, 0);
}

function minimum(ns: number[]): number {
  return ns.reduce((acc, x) => x < acc ? x : acc, 999999);
}

function countIf(ns: number[], pred: (x: number) => boolean): number {
  return ns.filter(pred).length;
}
