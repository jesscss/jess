import '@ungap/set-methods';

/**
 * Public API surface. Node classes/factories and their types come from the
 * tree barrel; everything else is exported explicitly from the modules below.
 * Core-internal helpers (print state, trivia emission, compare/cast/lookup
 * machinery) are intentionally NOT exported — import them relatively inside
 * core. See docs/archive/ponytail-core-audit.md (A1/A2).
 */
export * from './tree/index.js';

export { Context, TreeContext, type ContextOptions, type TreeContextOptions } from './context.js';
export { logger, type Logger } from './logger.js';
export * from './logger/deprecation-processing.js';
export * from './plugin.js';
export * from './jess-error.js';
export * from './deprecation.js';
export * from './define-function.js';

export { isNode } from './tree/util/is-node.js';
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
  setFieldSpans,
  valueSpansOf,
  setValueSpans,
  cstStateOf,
  setCstState,
  cstChildrenOf,
  setCstChildren,
  type SourceSpan,
  type Provenance
} from './tree/util/provenance.js';
export {
  coerceListItems,
  getListSeparator,
  isBracketedList,
  type ListItems
} from './tree/util/list-like.js';
export { serializeTypes, type SerializeTypesOptions } from './tree/util/serialize-types.js';
export {
  createRenderBuffer,
  finalizeFlatRenderBuffer,
  type FlatRenderBuffer,
  type RenderBuffer
} from './tree/util/render-buffer.js';
export {
  alphaToNumber,
  angleToDegrees,
  normalizeHue,
  percentOf,
  splitSequence,
  toNumber,
  type ConversionPlugin,
  type PreprocessParams
} from './conversions.js';
export * from './types/index.js';
export * from './visitor/index.js';
