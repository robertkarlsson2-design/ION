"use strict";
// ADT: Status
const Active = { _tag: "Active" };
const Inactive = { _tag: "Inactive" };
const Banned = { _tag: "Banned" };
const isActive = s => (() => {
  if (s._tag === "Active") {
    return true;
  } else {
    return false;
  }
})();
