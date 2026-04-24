"use strict";
// ADT: SafeResult
const Good = (_0) => ({ _tag: "Good", _0 });
const Bad = (_0) => ({ _tag: "Bad", _0 });
const isGood = r => (() => {
  if (r._tag === "Good") {
    return true;
  } else if (r._tag === "Bad") {
    return false;
  }
})();
