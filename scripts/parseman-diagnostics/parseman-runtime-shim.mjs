/**
 * Runtime stand-in for `parseman` used ONLY by the diagnostic scripts.
 *
 * `composeLeaf()` throws unconditionally at runtime ("requires Parseman macro
 * lowering; runtime composition is forbidden"), which is why the four jess
 * grammars cannot simply be `import`ed without the macro plugin. But
 * `compose()` — the non-leaf sibling — is fully implemented at runtime and
 * carries its source pieces on the `COMPOSED_PIECES` symbol, which is exactly
 * what `analyzeGrammarGating()` and `composedGrammarCoverageDefinitions()`
 * recover from.
 *
 * So this shim re-exports parseman verbatim except that `composeLeaf(items)`
 * delegates to `compose(items)` and stashes the raw pre-compose pieces on the
 * result. No grammar source is modified; the alias is applied by the loader.
 */
import * as parseman from 'parseman';

export * from 'parseman';

/** Raw `composeLeaf()` argument list, keyed by the composed result. */
export const COMPOSE_PIECES_RAW = Symbol.for('jess.diagnostics.composePiecesRaw');

export function composeLeaf(items, opts) {
  const composed = parseman.compose(items, opts);
  Object.defineProperty(composed, COMPOSE_PIECES_RAW, { value: items, enumerable: false });
  return composed;
}
