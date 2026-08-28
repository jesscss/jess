/**
 * Build entry for the AST Jess grammar.
 *
 * Each variant is built on its own so importing one never loads the others:
 * the compiled artifacts are multi-megabyte standalone tables and a single
 * shared module would make every consumer ingest all four. `parseman`'s macro
 * requires the `rules()` call to sit in the module that declares the factory,
 * so the instances stay in `../grammar.ts` and each variant entry re-exports
 * exactly one of them.
 */
export { jessGrammar } from '../grammar.js';
