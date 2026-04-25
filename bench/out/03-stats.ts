"use strict";
const filter = <A>(list: A[], pred: (a: A) => boolean): A[] => list.filter(pred);
const fold = <A, B>(list: A[], init: B, f: (acc: B, x: A) => B): B => list.reduce(f, init);
const length = <A>(list: A[]): number => list.length;
const total = (ns) => fold(ns, 0, (_a, _b) => _a + _b);
const mean = (ns) => total(ns) / length(ns);
const maximum = (ns) => fold(ns, 0, (acc, x) => x > acc ? x : acc);
const minimum = (ns) => fold(ns, 999999, (acc, x) => x < acc ? x : acc);
const countIf = (ns, pred) => length(filter(ns, pred));
