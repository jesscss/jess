/**
 * Dependency-free AST-v2 construction surface.
 *
 * Parsers may import this entry point to create the canonical AST without pulling
 * in evaluation, serialization, functions, or the legacy tree runtime.
 */
export * from './ast/node.js';
export * from './ast/nodes.js';
export * from './ast/at-rule.js';
// `Quoted` on the public value-evaluator barrel is an evaluated value result
// (`bytes`), not the parser-produced AST literal (`src`). Parsers constructing
// canonical AST data must use this explicit type name.
export type { Quoted as AstQuoted } from './ast/nodes.js';
