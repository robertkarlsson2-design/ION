"use strict";
const filter = <A>(list: A[], pred: (a: A) => boolean): A[] => list.filter(pred);
const range = (start: number, end: number): number[] => Array.from(Array(end - start), (_, i) => start + i);
const all = <A>(list: A[], pred: (a: A) => boolean): boolean => list.every(pred);
const head = <A>(list: A[]): A => list[0];
const isPrime = (n) => (n > 1) && all(range(2, n), (i): boolean => (n % i) !== 0);
const primesUpTo = (n) => filter(range(2, n + 1), isPrime);
const nthPrime = (n) => head(primesUpTo(n * 20));
