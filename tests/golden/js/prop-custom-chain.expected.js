"use strict";
// ADT: SafeResult
const Good = (_0) => ({ _tag: "Good", _0 });
const Bad = (_0) => ({ _tag: "Bad", _0 });
const wrap = x => Good(x);
const rewrap = x => (() => {
  if (wrap(x)._tag === "Good") {
    return Good(x);
  } else if (wrap(x)._tag === "Bad") {
    return Bad("err");
  }
})();
