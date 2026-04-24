"use strict";
const describe = n => (() => {
  if (n === 0) {
    return "zero";
  } else if (n === 1) {
    return "one";
  } else {
    return "many";
  }
})();
