# Node EvalState Status

Per-node audit for EvalState migration. Two dimensions:

1. **EvalState contract** — field reads/writes go through `activeState` (not canonical mutation)
2. **State carrying** — if the node creates a per-scope EvalState, it carries it on output via `_carriedState`

## Status Legend

| Status | Meaning |
| --- | --- |
| `clean` | All reads/writes use EvalState. No canonical mutations during eval. |
| `needs-fix` | Some eval paths still mutate canonical fields or miss state carrying. |
| `leaf` | Scalar/opaque node. No eval-time writes. |
| `inherited` | Inherits from parent class. |

## Core Eval Nodes

| Node | Status | Notes |
| --- | --- | --- |
| `Declaration` | `clean` | All writes via `setField`. All reads via context-aware getters. |
| `VarDeclaration` | `inherited` | Inherits Declaration. |
| `Ruleset` | `clean` | preEval uses `setField` for selector/guard. |
| `Rules` | `clean` | evalNode delegates to `_evaluateQueue` which writes via `activeState`. `_setValueArray` used only in constructor. |
| `AtRule` | `clean` | All field writes via `setField`. |
| `Mixin` | `clean` | preEval writes via `setField`. |
| `Call` | `clean` | evalNode routes through `evalMixinDirect`. No canonical mutations. |
| `Func` | `clean` | evalCall delegates to mixin machinery. |
| `Expression` | `clean` | evalNode is read-only + dependency tracking. |
| `Operation` | `clean` | All left/right writes via `setField`. |
| `Condition` | `clean` | Read-only eval. |
| `Sequence` | `clean` | All value writes via `setField` / `_setValue`. |
| `List` | `clean` | All value writes via `setField`. |
| `Reference` | `clean` | evalNode is read-only (resolves and returns value). |
| `Interpolated` | `clean` | Writes replacements via `setField`. |
| `Block` | `clean` | Writes value via `setField`. |
| `Paren` | `clean` | Writes value via `setField`, parents via `setParent`. |
| `Quoted` | `clean` | Writes value via `setField`. |
| `Control ($for)` | `clean` | pushState/popState per loop. Carries state via `_carriedState`. |
| `Ampersand` | `clean` | Reads via `getField`. No mutations. |
| `SelectorCapture` | `clean` | Writes value via `setField`. |

## Import Pipeline

| Node | Status | Notes |
| --- | --- | --- |
| `StyleImport` | `needs-fix` | **3 canonical mutations**: (1) `materializeCloneParentLinks` directly sets `child.parent` (line 228). (2) Restores canonical parents after import eval (line 713). (3) `setData` on deduped cache (line 755). These save/restore canonical state instead of using EvalState. Root cause of 18 import-style test failures. |
| `ImportJs` | `clean` | Reads via field helpers. |

## Selector Nodes

| Node | Status | Notes |
| --- | --- | --- |
| `BasicSelector` | `leaf` | |
| `AttributeSelector` | `clean` | Reads via context-aware getters. |
| `InterpolatedSelector` | `clean` | |
| `Ampersand` | `clean` | |
| `PseudoSelector` | `clean` | |
| `CompoundSelector` | `clean` | |
| `ComplexSelector` | `clean` | |
| `SelectorList` | `clean` | |

## Leaf Nodes

All `leaf` — no eval-time writes: Any, Bool, Color, Comment, Combinator, DefaultGuard, Dimension, JsArray, JsObject, JsFunction, JsExpression, Nil, Num.

## Mixin Pipeline (mixin-instance-primitives.ts)

| Function | Status | Notes |
| --- | --- | --- |
| `evaluateCandidateOutput` | `clean` | pushState/popState, carries state via `_carriedState`. All parent wiring AFTER pushState. |
| `finalizeMixinInvocationOutput` | `clean` | Creates lightweight `Rules.create(children)` per call. |
| `prepareMixinCandidateInvocation` | `clean` | No longer sets parents (moved to after pushState). |
| `prepareMixinInvocationScope` | `clean` | Creates ephemeral scope with canonical params. |
| `evaluateMixinArgs` | `clean` | Simplified — no deep copy/freeze, just eval. |
| `matchMixinCandidates` | `needs-fix` | Uses `param.setData('value', boundValue)` (line 1060) — canonical mutation on copied param. Acceptable since params are deep-copied per match, but should eventually use state. |

## Remaining Issues

1. **StyleImport canonical mutations** — 3 sites that mutate canonical parent/children. Causes 18 test failures.
2. **Nesting collapse** — `collapseNesting` needs context to compose selectors through state. Fixed in tests (12/13 pass).
3. **forEachNode array replacement** — writes array child replacements through state when state active, canonical when not. `_forEachNodeSync` still mutates canonical arrays for named-key children.
4. **`_carriedState`** — still needed because subtree storage on NodeState doesn't survive the eval pipeline's state transitions. See eval-state-sketch.md for architecture discussion.
