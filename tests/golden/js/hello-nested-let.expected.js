"use strict";
const addTwo = x => (() => {
  const a = __add__(x, 1);
  return (() => {
    const b = __add__(a, 1);
    return b;
  })();
})();
