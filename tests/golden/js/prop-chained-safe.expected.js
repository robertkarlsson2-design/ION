"use strict";
// ADT: SafeResult
const Good = (_0) => ({ _tag: "Good", _0 });
const Bad = (_0) => ({ _tag: "Bad", _0 });
const first = x => Good(x);
const second = x => (() => {
  if (first(x)._tag === "Good") {
    return Good(x);
  } else if (first(x)._tag === "Bad") {
    return Bad("fail");
  }
})();
