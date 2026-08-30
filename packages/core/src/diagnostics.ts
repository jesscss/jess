/**
 * Cold-path diagnostic construction.
 *
 * The four parser packages normalize a thrown parse error into an
 * `ErrorDiagnostic` at their `safeParse` boundary. Reaching `parserDiagnostic`
 * through the root entry made that one call put the whole of `@jesscss/core` —
 * evaluator, functions, legacy tree runtime, and their dependencies — on the
 * static import graph of the parser's package entry. Node's ESM loader does not
 * tree-shake, so every consumer that only wanted `parse` executed all of it.
 *
 * This entry exposes the diagnostic surface on its own so a parser can build a
 * diagnostic without loading the compiler. The root entry still re-exports
 * everything here.
 */
export {
  ERR,
  WARN,
  getErrorFromParser,
  makeJessError,
  makeJessErrorFromDiagnostic,
  parserDiagnostic,
  toDiagnostic
} from './error/diagnostics.js';
export type {
  ErrorDiagnostic,
  ParserDiagnosticOptions,
  ParserFailure,
  WarningDiagnostic
} from './error/diagnostics.js';
