"use strict";
const inc = x => x + 1;
const dbl = x => x + x;
const dec = x => x - 1;
const pipeline = x => dec(dbl(inc(x)));
