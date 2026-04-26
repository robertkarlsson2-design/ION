"use strict";
// ADT: Box
const Box = (_0) => ({ _tag: "Box", _0 });
const clamp = b => (() => {
  if (b._tag === "Box") {
    const v = b._0;
    if (v > 0) {
      return v;
    }
  }
  return 0;
})();
