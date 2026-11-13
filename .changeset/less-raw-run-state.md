---
"@jesscss/less-parser": patch
---

A raw `run()` of the `@jesscss/less-parser/grammar/*` tables gets its state from `createLessParseState(input, options)`, which builds the state `parse()` and `safeParse()` build and checks the options the same way. The state is opaque (`LessRunState`). `recoveredProblemsOf(state, result)` takes it and what `run()` returned, and lists the recovered problems `safeParse()` reports for a completed stylesheet run: each problem that reaches its tree, once, in source order. For a run that stopped short the list is empty, so an empty list does not mean success: check `result.ok`, `unconsumedFrom` and `errors` yourself.
