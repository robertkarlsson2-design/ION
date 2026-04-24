"use strict";
const inc = x => __add__(x, 1);
const dbl = x => __add__(x, x);
const dec = x => __sub__(x, 1);
const pipeline = x => dec(dbl(inc(x)));
