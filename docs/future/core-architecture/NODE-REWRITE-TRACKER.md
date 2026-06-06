# Node Rewrite Tracker

This tracker owns the node-by-node cleanup program. The rule is simple: finish
one node rewrite pass at a time, prove output with focused unit tests before and
after, and prefer structural facts, straight loops, fewer branches, fewer
function calls, and fewer conversions.

Do not mark a node complete because one helper changed. A node is complete when
its public render/eval/resolve/value methods have been reviewed for:

- string/render output used as a decision predicate;
- unnecessary node creation, copying, `.inherit(...)`, or metadata mutation;
- array helpers, generators, nested hot closures, tuple arrays, or helper
  ladders;
- repeated conversion through `valueOf()`, `toString()`, regex, `String(...)`,
  `.join(...)`, `.slice(...)`, writer capture, or `getSince(...)`;
- branches that should be parser/adoption/eval flags or direct structural
  checks.

| Node | File | Base/family | Status | Rewrite notes |
| --- | --- | --- | --- | --- |
| Ampersand | `packages/core/src/tree/ampersand.ts` | `SimpleSelector` | queued | Replace template text splitting with selector-list structure and placement state. |
| Anonymous | `packages/core/src/tree/any.ts` | `Any` | queued | Audit scalar value/render/compare only after `Any`. |
| Any | `packages/core/src/tree/any.ts` | `Node` | queued | Audit compare/string conversion and numeric regex decisions. |
| AtRule | `packages/core/src/tree/at-rule.ts` | `Node` | queued | High priority: reduce custom eval/import/render branches. |
| AttributeSelector | `packages/core/src/tree/selector-attr.ts` | `SimpleSelector` | queued | Audit interpolation eval, valueOf construction, and attribute render capture. |
| BasicSelector | `packages/core/src/tree/selector-basic.ts` | `SimpleSelector` | queued | Audit selector kind flags versus text prefix checks. |
| Block | `packages/core/src/tree/block.ts` | `Node` | queued | Audit wrapper/render/eval paths. |
| Bool | `packages/core/src/tree/bool.ts` | `Node` | queued | Audit scalar render/eval and allocation sites. |
| Call | `packages/core/src/tree/call.ts` | `Node` | queued | High priority: callable output, async path, helper ladders, repeated eval. |
| Collection | `packages/core/src/tree/collection.ts` | `Rules` | queued | Audit wrapper necessity after `Rules`. |
| Color | `packages/core/src/tree/color.ts` | `Node` | queued | Audit conversions, string formatting, and function-library paths. |
| Combinator | `packages/core/src/tree/combinator.ts` | `Selector` | queued | Audit scalar selector rendering and keysets. |
| Comment | `packages/core/src/tree/comment.ts` | `Node` | queued | Audit line/block branch and direct render. |
| ComplexSelector | `packages/core/src/tree/selector-complex.ts` | `Selector` | queued | Audit valueOf caching, malformed repair, render loops, and selector metadata. |
| CompoundSelector | `packages/core/src/tree/selector-compound.ts` | `Selector` | queued | Audit component valueOf classification and allocation arrays. |
| Condition | `packages/core/src/tree/condition.ts` | `Node` | queued | Audit bool result materialization and comparison render paths. |
| CustomDeclaration | `packages/core/src/tree/declaration-custom.ts` | `Declaration` | queued | Audit custom-property eval/render after `Declaration`. |
| Declaration | `packages/core/src/tree/declaration.ts` | `Node` | queued | High priority: custom property branches, merge state, materialization. |
| DefaultGuard | `packages/core/src/tree/default-guard.ts` | `Node` | queued | Audit scalar guard render/eval. |
| Dimension | `packages/core/src/tree/dimension.ts` | `Node` | queued | Audit regex/unit conversion and operation paths. |
| Expression | `packages/core/src/tree/expression.ts` | `Node` | queued | Audit wrapper necessity and direct child render. |
| Extend | `packages/core/src/tree/extend.ts` | `Node` | queued | Audit selector valueOf comparisons and resolved selector state. |
| ExtendList | `packages/core/src/tree/extend-list.ts` | `Node` | queued | Audit list wrapper render/eval. |
| For | `packages/core/src/tree/control.ts` | `Node` | queued | Audit loop state, body materialization, and async branches. |
| Func | `packages/core/src/tree/function.ts` | `Node` | queued | Audit function call render/eval and param output. |
| If | `packages/core/src/tree/control.ts` | `Node` | queued | Audit condition/body materialization and branch count. |
| Interpolated | `packages/core/src/tree/interpolated.ts` | `Node` | queued | High priority: string assembly, selector eval, and replacement arrays. |
| InterpolatedSelector | `packages/core/src/tree/selector-interpolated.ts` | `SimpleSelector` | queued | Replace regex over `valueOf()` with carried selector kind when possible. |
| JsArray | `packages/core/src/tree/js-array.ts` | `Node` | queued | Audit public wrapper necessity. |
| JsExpression | `packages/core/src/tree/js-expr.ts` | `Node` | queued | Audit eval-to-string and scalar output. |
| JsFunction | `packages/core/src/tree/js-function.ts` | `Node` | queued | Audit wrapper and call integration. |
| JsImport | `packages/core/src/tree/import-js.ts` | `Node` | queued | Audit import render/eval and path conversion. |
| JsObject | `packages/core/src/tree/js-object.ts` | `Node` | queued | Audit public wrapper necessity. |
| Keyword | `packages/core/src/tree/any.ts` | `Any` | queued | Audit after `Any`; likely scalar-only. |
| List | `packages/core/src/tree/list.ts` | `Node` | queued | High priority: eval/render item loops, no resolve-then-stringify arrays. |
| Log | `packages/core/src/tree/log.ts` | `Node` | queued | Audit side-effect eval/render path. |
| Mixin | `packages/core/src/tree/mixin.ts` | `Node` | queued | High priority: guard/default/body copy and callable candidate output. |
| MixinCollection | `packages/core/src/tree/util/callable-collection.ts` | `Node` | queued | Audit whether this public node wrapper is still necessary. |
| Negative | `packages/core/src/tree/negative.ts` | `Node` | queued | Audit unit/text classification and direct render. |
| Nil | `packages/core/src/tree/nil.ts` | `Node` | queued | Audit singleton/scalar allocation possibility. |
| Num | `packages/core/src/tree/number.ts` | `Dimension` | queued | Audit after `Dimension`. |
| Operation | `packages/core/src/tree/operation.ts` | `Node` | queued | High priority: arithmetic eval, render directness, operand loops. |
| Paren | `packages/core/src/tree/paren.ts` | `Node` | queued | Audit guard/string conversions and direct render. |
| PseudoSelector | `packages/core/src/tree/selector-pseudo.ts` | `SimpleSelector` | complete | Replaced comma-text unwrap decision with structural item-count logic, removed generated-state helper/object allocation, and deleted dead keys experiment. Verified with selector pseudo/selector/ampersand output tests. |
| QueryCondition | `packages/core/src/tree/query-condition.ts` | `Sequence` | queued | Audit after `Sequence`; remove wrapper branches if possible. |
| Quoted | `packages/core/src/tree/quoted.ts` | `Node` | queued | Audit interpolation/replacement and string escape paths. |
| Range | `packages/core/src/tree/range.ts` | `Node` | queued | Audit loop/range output and allocations. |
| RawRules | `packages/core/src/tree/rules-raw.ts` | `Rules` | queued | Audit after `Rules`; keep raw render direct. |
| Reference | `packages/core/src/tree/reference.ts` | `Node` | in progress | Passes 1-6 deleted alias predicates, result/fallback/materialization wrapper helpers, the useless `evalNode(...)` Promise wrapper, direct render closures, option spread helpers, scope-array walker, runtime-key IIFE, small `findVarDeclarationFast(...)` result/IIFE allocations, duplicate fallback/copy/static-return branches, callable surface rechecks, raw lookup sync-path closure/IIFE setup, main eval lookup closure setup, static declaration public-resolve copy/inherit for non-important/non-merged containers, and per-call `findVarDeclarationFast(...)` helper closure allocation for bucket selection/candidate ordering/deferred dynamic-name promotion. Remaining: rules-like surfaces, dynamic declaration finalization, merged assign normalization, and key conversion. |
| Rest | `packages/core/src/tree/rest.ts` | `Node` | queued | Audit scalar/rest wrapper paths. |
| Rules | `packages/core/src/tree/rules.ts` | `Node` | queued | High priority: body eval/render, imports, placement state, merge output. |
| Ruleset | `packages/core/src/tree/ruleset.ts` | `Node` | queued | High priority: selector composition, body prep, wrappers, render branches. |
| Selector | `packages/core/src/tree/selector.ts` | `Node` | queued | Audit base selector metadata and keyset invalidation. |
| SelectorCapture | `packages/core/src/tree/selector-capture.ts` | `Node` | queued | Audit whether capture node should exist after render rewrite. |
| SelectorList | `packages/core/src/tree/selector-list.ts` | `Selector` | queued | High priority: render flattening, temporary arrays, valueOf joins. |
| Sequence | `packages/core/src/tree/sequence.ts` | `Node` | queued | High priority: eval/render item loops and array materialization. |
| SimpleSelector | `packages/core/src/tree/selector-simple.ts` | `Selector` | queued | Audit base class necessity and branches. |
| StyleImport | `packages/core/src/tree/import-style.ts` | `Node` | queued | High priority: first-use placement copies and derived rules surfaces. |
| Url | `packages/core/src/tree/url.ts` | `Node` | queued | Audit wrapper and direct render/eval. |
| VarDeclaration | `packages/core/src/tree/declaration-var.ts` | `Declaration` | queued | Audit after `Declaration`; preserve Less variable semantics. |
| While | `packages/core/src/tree/control.ts` | `Node` | queued | Audit loop state, body materialization, and async branches. |
