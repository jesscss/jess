/**
 * The `ast/` public surface.
 *
 * HARD MODULE BOUNDARY: no file under `ast/` imports from the legacy `tree/`
 * directory. This is a from-scratch AST + serializer.
 */

export { type Node, type NodeType, type Combinator, isNode, AST_NODE_TYPES } from './node.js';
export * from './nodes.js';
// [atrule] at-rule node types + constructors
export * from './at-rule.js';
// typed synchronous value-evaluator seam + boundary-clean value domain.
// NOTE: the value `type:'Dimension'` result is NOT re-exported here — it collides
// with the AST `type:'Dimension'` node (`nodes.ts`). It stays module-qualified:
// import it directly from `./value-eval.js`. The split is perf-justified (a static
// `3px` is a bare literal string, never a value `Dimension`); the two share a
// `type` string but live in disjoint unions (`Node` vs `ValueObj`) that are never
// merged, so never form a `Node | ValueObj` union.
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
// [value path] the boundary-clean value serializer + operate + kind-dispatch that
// the fns/ conversion sits on.
export { serializeValue, serializeDimension, serializeQuoted } from './serialize-value.js';
export { serializeColor } from './color.js';
export { buildEvaluator } from './evaluator.js';
export { createFnRegistry, type FnRegistry } from './value-dispatch.js';
// [value-literal-tag] the parser's LIT_* classification (VALUE-LITERAL-TAG-SPEC).
export { LiteralTag, materializeLiteral, tagForWord, sniffLiteral } from './literal-tag.js';
export type { LitFields } from './literal-tag.js';
