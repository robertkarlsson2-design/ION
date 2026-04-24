"use strict";
// ADT: Named
const Named = (id) => ({ _tag: "Named", id });
const getId = n => (() => {
  if (n._tag === "Named") {
    const id = n.id;
    return id;
  } else {
    return 0;
  }
})();
