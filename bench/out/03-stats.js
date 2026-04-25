"use strict";
const filter = (list, pred) => list.filter(pred);
const fold = (list, init, f) => list.reduce(f, init);
const length = list => list.length;
const total = ns => fold(ns, 0, (_a, _b) => _a + _b);
const mean = ns => total(ns) / length(ns);
const maximum = ns => fold(ns, 0, (acc, x) => x > acc ? x : acc);
const minimum = ns => fold(ns, 999999, (acc, x) => x < acc ? x : acc);
const countIf = (ns, pred) => length(filter(ns, pred));
