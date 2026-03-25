# Node Session Status

## Purpose

This file tracks node status relative to the session-instance model.

## Global Gate

The session-instance model is now landed:

- `SessionInstanceRoot` — many instances of one canonical subtree in one session
- Sparse shadow state — only divergent nodes get entries
- Instance-root-aware helpers — resolution: instanceRoot → session → canonical
- Dependency reach — narrows shadow entries to affected nodes
- Import eval path — wired with instance roots

Remaining: mixin eval path wiring (documented in PROGRESS.md).

## Status Legend

| Status | Meaning |
| --- | --- |
| `instance-ready` | This node works correctly under the instance-root model. |
| `wired` | Instance roots are wired into this node's eval path. |
| `bridge-stable` | Bridge work is landed; instance root wiring is not yet active for this node's eval path. |
| `leaf` | Effectively scalar or opaque for this work. |
| `inherited` | Status follows a parent/base node. |

## Wired Nodes

These nodes have instance roots active in their eval paths.

| Node | Status | Detail |
| --- | --- | --- |
| `StyleImport` | wired | Instance root created per import placement in evalNode. |

## Instance-Ready (Model Proved)

These nodes are proved by the session-instance proof tests but their eval paths are not yet wired.

| Node | Status | Detail |
| --- | --- | --- |
| `Call` | instance-ready | Proof tests show 3 instance roots over one mixin body. Eval path needs `getFunctionFromMixins` restructure. |
| `Mixin` | instance-ready | Proof tests show independent eval state per call. Eval path needs restructure. |
| `Func` | instance-ready | Same model as Mixin. Eval path needs restructure. |
| `Rules` | instance-ready | Children overlays and parent chains proved per instance root. Used as instance root source. |

## Bridge-Stable Nodes

These nodes are not the current architectural owners. Re-audit after mixin wiring.

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

## How To Read Statuses

- `wired` means instance roots are actively used in the eval path
- `instance-ready` means the model is proved but the eval path still uses the bridge
- `bridge-stable` means bridge work is landed but the node is not a current proof case
- Re-audit bridge-stable nodes after mixin eval path wiring

## Remaining Work

The next work is:

1. Restructure `getFunctionFromMixins` to accept instance roots per candidate
2. Wire instance roots in `call.ts` for function/mixin results
3. Retire clone wrappers that become unnecessary
4. Re-audit bridge-stable nodes after wiring is complete
