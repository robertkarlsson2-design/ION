"use strict";
const addTwo = x => (() => {
  const a = x + 1;
  return (() => {
    const b = a + 1;
    return b;
  })();
})();
