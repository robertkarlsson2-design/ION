/* @generated — do not edit */
/* source: ion/src/wire/stats.ion */
// @ts-nocheck
/* eslint-disable */
"use strict";
export const byteSize = (src: never) => src.length;
export const lineCount = (src: never) => src.split("\n").length;
export const expansionRatio = (wire: never, compiled: never) => compiled.length / wire.length;
export const compressionRate = (wire: never, source: never) => (source.length - wire.length) / source.length;
