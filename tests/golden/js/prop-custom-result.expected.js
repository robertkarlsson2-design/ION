"use strict";
// ADT: SafeResult
const Good = (_0) => ({ _tag: "Good", _0 });
const Bad = (_0) => ({ _tag: "Bad", _0 });
const succeed = x => Good(x);
