"use strict";
const a = x => x + 1;
const b = x => x + x;
const c = x => x - 1;
const d = x => x * 2;
const fourStep = x => d(c(b(a(x))));
