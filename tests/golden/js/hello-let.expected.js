"use strict";
const addOne = x => (() => {
  const n = __add__(x, 1);
  return n;
})();
