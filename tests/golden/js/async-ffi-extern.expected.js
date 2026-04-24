"use strict";
const promiseResolve = x => Promise.resolve(x);
const wrap = x => promiseResolve(x);
