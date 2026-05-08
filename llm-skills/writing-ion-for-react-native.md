---
name: writing-ion-for-react-native
description: Per-target reference for writing Ion that compiles to React Native TSX. Covers primitive mapping, attribute remapping, style translation, __platform__ builtins, image sources, AppRegistry, and known gaps. Load this after write-ion.md when the build target is react-native.
type: skill
---

# Writing Ion for React Native

Full reference: `llm-docs/react-native.md`.

Load that file. It covers: the RN primitive set, attribute conventions, style translation (inline + StyleSheet.create hoisting), `__platform__` / `__platform_select__` wire-format patterns, image source handling, AppRegistry auto-emit, SafeAreaView routing, navigation gaps, a complete Login screen worked example, and a gap summary table.

The tests in `tests/emit/react-native.test.ts` are the authoritative spec — if a pattern is not tested there, treat it as unverified.
