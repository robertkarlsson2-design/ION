"use strict";
const a = x => __add__(x, 1);
const b = x => __add__(x, x);
const c = x => __sub__(x, 1);
const d = x => __mul__(x, 2);
const fourStep = x => d(c(b(a(x))));
