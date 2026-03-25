# Node Session Status

## Purpose

This file tracks node status relative to the current bridge, while keeping the branch anchored to the final session-instance model.

Read the rows this way:

- they describe how settled a node is under the current bridge
- they do not mean the final architecture is solved

## Global Gate

No node inventory is enough to merge this branch until the session-instance model lands:

- one immutable source tree
- many lazy session-local instances over it
- sparse dependency-guided shadow state

## Status Legend

| Status | Meaning |
| --- | --- |
| `proof-case` | This node is actively proving that the bridge is insufficient and the instance model is needed. |
| `bridge-stable` | Useful bridge work is landed and locally stable enough to stop prioritizing the node for now. Re-audit later. |
| `leaf` | Effectively scalar or opaque for this work. |
| `inherited` | Status follows a parent/base node. |

## Current Proof Cases

These are the nodes that should keep the branch oriented toward the final model.

| Node | Why it matters now |
| --- | --- |
| `Call` | Same-source composite `Rules` results are the sharpest proof that one-overlay-per-node is not enough. |
| `StyleImport` | Repeated imports need distinct instance roots with thin local state. |
| `Mixin` | Repeated invocation over one canonical body needs sparse per-call shadow state. |
| `Func` | Composite function returns need the same instance-root model as mixins/imports. |
| `Rules` | Still exposes lower wrapper/clone behavior that the proof cases fall through. |

## Bridge-Stable Nodes

These nodes are not the current architectural owners.

### Bridge-stable containers

- `Ruleset`
- `Declaration`
- `RawRules`
- `AtRule`
- `Expression`
- `Operation`
- `Condition`
- `List`
- `Sequence`
- `Block`
- `Collection`
- `Extend`
- `ExtendList`
- `Reference`
- `JsImport`
- `Interpolated`
- `Paren`
- `Quoted`
- `Url`
- `Negative`
- `Rest`
- `Range`
- `Control` (`If`, `For`, `Each`, `While`)

### Bridge-stable selector nodes

- `SelectorCapture`
- `SelectorList`
- `ComplexSelector`
- `CompoundSelector`
- `PseudoSelector`
- `SelectorAttr`
- `SelectorInterpolated`
- `Ampersand`

## Inherited

- `VarDeclaration` follows `Declaration`

## Leaves / Opaque Values

- `Any`
- `Keyword`
- `Bool`
- `Dimension`
- `Num`
- `Color`
- `Nil`
- `BasicSelector`
- `Combinator`
- `Comment`
- `DefaultGuard`
- `JsExpr`
- `JsArray`
- `JsObject`
- `JsFunction`

## How To Read “Bridge-Stable”

`bridge-stable` means:

- local migration work is good enough for now
- the node is not the current proof case
- revisit it after instance roots and lazy node views are real

It does not mean:

- final architecture complete
- safe to ignore after the stage reset

## Immediate Work

The next work is not “touch every remaining row.”

It is:

1. land instance roots
2. land lazy node views
3. move sparse shadow state to those roots
4. connect dependency reach to sparse writes
5. prove repeated imports
6. prove repeated mixin/function reuse
