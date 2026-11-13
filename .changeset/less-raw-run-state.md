---
"@jesscss/less-parser": patch
---

A raw `run()` of the `@jesscss/less-parser/grammar/*` tables gets its state from `createLessParseState(input, options)`, which builds the state `parse()` and `safeParse()` build and checks the options the same way. The state is opaque (`LessRunState`). `recoveredProblemsOf(state, result)` takes it and what `run()` returned, and lists exactly the recovered problems `safeParse()` reports for that run: none for a run that stopped short, and for a completed run each problem that reaches its tree, once, in source order.
