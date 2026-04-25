/* @generated — do not edit */
/* source: ion/src/prelude/shake.ion */
// @ts-nocheck
/* eslint-disable */
"use strict";
export const collectNames = (node: never) => node.kind === "Var" ? [node.name] : node.kind === "App" ? node.args.reduce((acc: never, child: never) => acc.concat(collectNames(child)), collectNames(node.callee)) : node.kind === "Abs" ? collectNames(node.body) : node.kind === "Let" ? collectNames(node.value).concat(collectNames(node.body)) : node.kind === "Case" ? node.arms.reduce((acc: never, arm: never) => acc.concat(collectNames(arm.body)), collectNames(node.scrutinee)) : node.kind === "OopVirtualCall" ? collectNames(node.receiver).concat(node.args.reduce((acc2: never, child: never) => acc2.concat(collectNames(child)), [])) : node.kind === "Accessor" ? collectNames(node.receiver) : node.kind === "ListLit" ? node.elements.reduce((acc: never, el: never) => acc.concat(collectNames(el)), []) : node.kind === "AdtMatch" ? node.arms.reduce((acc: never, arm: never) => acc.concat(collectNames(arm.body)), collectNames(node.scrutinee)) : [];
export const collectAllNames = (decls: never) => decls.reduce((acc: never, decl: never) => acc.concat(collectNames(decl)), []);
export const shouldKeepDecl = (decl: never, names: never) => decl.kind === "Let" ? decl.value.kind === "ForeignRef" ? names.includes(decl.name) : true : true;
