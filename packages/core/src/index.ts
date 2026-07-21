import '@ungap/set-methods';

/**
 * Public API surface. Node classes/factories and their types come from the
 * tree barrel; everything else is exported explicitly from the modules below.
 * Core-internal helpers (print state, trivia emission, compare/cast/lookup
 * machinery) are intentionally NOT exported — import them relatively inside
 * core. See docs/future/core-architecture/CORE-CLEANUP.md.
 */
export * from './tree/index.js';

export {
  Context,
  DocumentContext,
  TreeContext,
  type ContextOptions,
  type DocumentContextOptions,
  type SourceContext,
  type TreeContextOptions,
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
export * from './define-function.js';

export { isNode } from './tree/util/is-node.js';
// Single-pass spine (cutover P1/P2): the pass-count RATCHET counter + the static
// eligibility predicate. Exported so PRODUCTION-path tests (the jess Compiler)
// can assert real spine routing (≥N corpus roots) and that the eval two-walk is
// not entered for a wired extend-free eligible root.
export { spineRenderCounter, isSpineEligibleRoot } from './tree/util/emit-walk.js';
export { engageExtendLayer, isSpineExtendTopology, treeHasExtend, extendLayerCounter } from './tree/extend/spine-extend.js';
export { type Operator } from './tree/util/calculate.js';
export {
  shouldOperateWithMathFrames,
  type MathFrameState
} from './tree/util/should-operate.js';
export { type PrintOptions } from './tree/util/print.js';
export { makeTrivia, createTriviaMap } from './tree/util/trivia.js';
export {
  sourceSpanOf,
  spanStartOf,
  spanEndOf,
  setSourceSpan,
  copySourceSpan,
  isSourceFree,
  fieldSpansOf,
  fieldSpanAt,
  setFieldSpans,
  valueSpansOf,
  valueSpanAt,
  setValueSpans,
  type SourceSpan
} from './tree/util/provenance.js';
export {
  coerceListItems,
  getListSeparator,
  isBracketedList,
  type ListItems
} from './tree/util/list-like.js';
export { serializeTypes, type SerializeTypesOptions } from './tree/util/serialize-types.js';
/** Canonical AST-v2 stylesheet execution. Parser construction stays under `./ast`. */
export { serialize } from './ast/serialize.js';
/** Construct the typed value evaluator used by the canonical AST-v2 execution path. */
export { buildEvaluator } from './ast/evaluator.js';
export {
  createRenderBuffer,
  finalizeFlatRenderBuffer,
  type FlatRenderBuffer,
  type RenderBuffer
} from './tree/util/render-buffer.js';
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
export * from './visitor/index.js';
