"use strict";
const filter = (list, pred) => list.filter(pred);
const range = (start, end) => Array.from(Array(end-start),(_,i)=>start+i);
const all = (list, pred) => list.every(pred);
const head = list => list[0];
const isPrime = n => n > 1 && all(range(2, n), i => n % i !== 0);
const primesUpTo = n => filter(range(2, n + 1), isPrime);
const nthPrime = n => head(primesUpTo(n * 20));
