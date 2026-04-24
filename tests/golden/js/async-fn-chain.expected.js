"use strict";
const base = () => 42;
const derived = () => (() => {
  const x = 42;
  return x;
})();
