"use strict";
// ADT: Maybe
const Nothing = { _tag: "Nothing" };
const Just = (_0) => ({ _tag: "Just", _0 });
const hasValue = m => (() => {
  if (m._tag === "Just") {
    return true;
  } else if (m._tag === "Nothing") {
    return false;
  }
})();
