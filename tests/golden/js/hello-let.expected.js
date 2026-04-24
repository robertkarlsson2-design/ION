"use strict";
const addOne = x => (() => {
  const n = x + 1;
  return n;
})();
