/**
 * Build entry for the terminal-up grammar.
 *
 * Exports under the harness's contract names — `cssGrammar` for AST and
 * `cssCstGrammar` for CST/doc. Exporting the CST artifact is not optional:
 * the CST surface pins the production set, so an entry without it would be
 * graded on the easier half only.
 */
export { cssTerminalUpB1Grammar, cssGrammar, cssCstGrammar } from '../src/grammar-terminal-up-b1.js';
