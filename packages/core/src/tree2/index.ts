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
export {
  DEFAULT_MODES,
  emitValue,
  isLiteral,
  literal,
  type BoolVal,
  type ColorVal,
  type EvalModes,
  type Keyword,
  type ListVal,
  type NilVal,
  type Numeric,
  type Quoted,
  type Value,
  type ValueEvaluator,
  type ValueLiteral,
  type ValueObj,
  type VTag,
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
