"use strict";
// ADT: Color
const Red = { _tag: "Red" };
const Green = { _tag: "Green" };
const Blue = { _tag: "Blue" };
const colorName = c => (() => {
  if (c._tag === "Red") {
    return "red";
  } else if (c._tag === "Green") {
    return "green";
  } else if (c._tag === "Blue") {
    return "blue";
  }
})();
