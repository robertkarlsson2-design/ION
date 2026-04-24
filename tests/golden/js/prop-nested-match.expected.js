"use strict";
// ADT: Maybe
const Nothing = { _tag: "Nothing" };
const Just = (_0) => ({ _tag: "Just", _0 });
// ADT: SafeResult
const Good = (_0) => ({ _tag: "Good", _0 });
const Bad = (_0) => ({ _tag: "Bad", _0 });
const outerMatch = r => (() => {
  if (r._tag === "Good") {
    return (() => {
      if (r._tag === "Good") {
        return 1;
      } else if (r._tag === "Bad") {
        return 2;
      } else if (r._tag === "Bad") {
        return 0;
      }
    })();
  }
})();
