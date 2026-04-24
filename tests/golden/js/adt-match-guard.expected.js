"use strict";
// ADT: MaybeInt
const NoneI = { _tag: "NoneI" };
const SomeI = (_0) => ({ _tag: "SomeI", _0 });
const positiveOrZero = x => (() => {
  if (x._tag === "SomeI" && __gt__(v, 0)) {
    const v = x.v;
    return v;
  } else {
    return 0;
  }
})();
