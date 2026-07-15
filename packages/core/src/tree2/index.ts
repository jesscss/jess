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
export type { ValueService } from './value-service.js';
// [guards] guard model + overloaded-mixin dispatch
export { evalGuard, guardUsesDefault, type GuardNode, type ValueResolver } from './guard.js';
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
  type Position,
} from './serialize.js';
