/**
 * Clean-room tree2 public surface.
 *
 * HARD MODULE BOUNDARY: no file under `tree2/` imports from the legacy tree
 * directory. This is a from-scratch AST + serializer grown bottom-up via the
 * per-shape tree2-vs-tree head-to-head harness.
 */

export { Kind, Tree2Node, type Combinator } from './node.js';
export * from './nodes.js';
export {
  serialize,
  composeStats,
  type ComposeStats,
  type SerializeOptions,
  type SerializeResult,
  type Tree2Position,
} from './serialize.js';
