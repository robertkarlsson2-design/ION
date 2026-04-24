"use strict";
// ADT: Outcome
const Win = { _tag: "Win" };
const Lose = (_0) => ({ _tag: "Lose", _0 });
const outcomeMsg = o => (() => {
  if (o._tag === "Win") {
    return "won";
  } else if (o._tag === "Lose") {
    return "lost";
  }
})();
