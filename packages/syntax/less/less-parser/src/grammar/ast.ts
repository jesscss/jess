/**
 * Build entry for the AST Less grammar.
 *
 * Each variant is built on its own so importing one never loads the others:
 * the compiled artifacts are ~4 MB each and a single shared module would make
 * every consumer ingest all four. `parseman`'s macro requires the `rules()`
 * call to sit in the module that declares the factory, so the instances stay in
 * `../grammar.ts` and each variant entry re-exports exactly one of them.
 */
export { lessGrammar } from '../grammar.js';
