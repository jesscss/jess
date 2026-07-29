import '@ungap/set-methods';

/**
 * Public API surface. The old tree classes are intentionally not exported from
 * the package root; consumers should use the AST/value entrypoints below.
 * Core-internal helpers (print state, trivia emission, compare/cast/lookup
 * machinery) are intentionally NOT exported — import them relatively inside
 * core. See docs/architecture/core/CORE-CLEANUP.md.
 */

export {
  Context,
  DocumentContext,
  type ContextOptions,
  type DocumentContextOptions,
  type SourceContext,
  type SpineVisitor,
  type SpineVisitorEnter,
  type SpineVisitorExit
} from './context.js';
export { logger, type Logger } from './logger.js';
export {
  type DiagnosticDisplay,
  type WarningsConfig,
  type WarningsConfigInput,
  type ErrorsConfig,
  type ErrorsConfigInput,
  type ResolvedWarningsConfig,
  type ResolvedErrorsConfig,
  warnCodeMatches,
  warnCodeMatchesAny,
  resolveWarningsConfig,
  resolveErrorsConfig
} from './warnings.js';
export * from './plugin.js';
export * from './jess-error.js';
export * from './deprecation.js';
export type { ApplySelectorKind, ExtendSelectorKind, SelectorPolicyKind } from './types/config.js';

/** Canonical AST-v2 stylesheet execution. Parser construction stays under `./ast`. */
export { prepareStaticImports, serialize } from './ast/serialize.js';
export type { PreparedImports, PrepareStaticImportsOptions, SerializeOptions } from './ast/serialize.js';

/** Construct the typed value evaluator used by the canonical AST-v2 execution path. */
export { buildEvaluator } from './ast/evaluator.js';
export {
  alphaToNumber,
  normalizeHue,
  percentOf,
  splitSequence,
  toNumber,
  type ConversionPlugin,
  type PreprocessParams
} from './conversions.js';
export * from './types/index.js';
