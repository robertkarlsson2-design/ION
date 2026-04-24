"use strict";
// ADT: Maybe
const Nothing = { _tag: "Nothing" };
const Just = (_0) => ({ _tag: "Just", _0 });
const just = x => Just(x);
