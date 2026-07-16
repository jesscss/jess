/**
 * Clean-room tree2 public surface.
 *
 * HARD MODULE BOUNDARY: no file under `tree2/` imports from the legacy tree
 * directory. This is a from-scratch AST + serializer grown bottom-up via the
 * per-shape tree2-vs-tree head-to-head harness.
 */

export { Kind, Node, type Combinator } from './node.js';
export * from './nodes.js';
// [atrule] at-rule node types + constructors
export * from './at-rule.js';
// [R2] typed synchronous value-evaluator seam + boundary-clean value domain.
// NOTE: the value `Dimension` is NOT re-exported here — it collides with the AST
// `Dimension` node (`nodes.ts`). It stays module-qualified: import it directly
// from `./value-eval.js`. The split is perf-justified (a static `3px` is a bare
// literal string, never a value `Dimension`).
export {
  DEFAULT_MODES,
  emitValue,
  isLiteral,
  literal,
  type Bool,
  type Color,
  type EvalModes,
  type Keyword,
  type List,
  type Nil,
  type Quoted,
  type Value,
  type ValueEvaluator,
  type ValueObj,
} from './value-eval.js';
// [guards] guard model + overloaded-mixin dispatch
export { evalGuard, guardUsesDefault, type GuardNode, type TypedResolver, type ValueResolver } from './guard.js';
export {
  bindArgs,
  selectDefinitions,
  type CallArg,
  type Selection,
} from './mixin-dispatch.js';
export {
  serialize,
  composeStats,
  type ComposeStats,
  type SerializeOptions,
  type SerializeResult,
  type SerializeReturn,
  type Position,
} from './serialize.js';
// [native value path] boundary-clean serializer + operate + kind-dispatch that
// the fns/ conversion sits on. Built ALONGSIDE the transitional adapter and
// gated byte-identical against it (see native-evaluator.ts).
export { serializeValue, serializeColor, serializeDimension, serializeQuoted, OutputMode } from './serialize-value.js';
export { buildNativeEvaluator } from './native-evaluator.js';
export { dispatchNative, hasNativeFn, NATIVE_FNS } from './value-dispatch.js';
// [value-literal-tag] the parser's LIT_* classification (VALUE-LITERAL-TAG-SPEC).
export { LiteralTag, materializeLiteral, tagForWord, sniffLiteral } from './literal-tag.js';
