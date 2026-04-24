"use strict";
const sign = x => (() => {
  if (__lt__(x, 0) === true) {
    return __sub__(0, x);
  } else {
    return x;
  }
})();
