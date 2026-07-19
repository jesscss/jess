// Production ast/ render surface consumed by the Less consumer layer
// (`@jesscss/plugin-less`) to render `.less` end-to-end through the AST-v2 engine
// — the engine-cutover render path. A NARROW, named contract (mirrors `./value`):
// the parser-agnostic whole-document pipeline + the value-evaluator builder, so
// the consumer supplies the Less grammar + inline-JS guard + built-in fn registry
// and drives a full render without reaching into core internals.
//
// This barrel exposes ZERO parser/fns edges (core imports neither); the dialect
// binding stays entirely on the consumer side.

// --- whole-document render pipeline (parser-agnostic) ---
export { renderAstDoc, renderAstFile } from './ast/parse-host/render-doc.js';
export type { AstRenderResult, AstRenderOptions } from './ast/parse-host/render-doc.js';

// --- injected node_modules / package-specifier `@import` resolver type ---
export type { ModuleResolver } from './ast/parse-host/import.js';

// --- value evaluator builder + injected-evaluator type ---
export { buildEvaluator } from './ast/evaluator.js';
export type { ValueEvaluator, PluginHost } from './ast/value-eval.js';

// --- plugin runtime authoring surface (the `Fn` contract a shim adapts to) ---
export type { Fn, FnCtx } from './ast/functions/types.js';
export {
  makeDimension,
  makeColorRgb,
  makeQuoted,
  makeKeyword,
  makeList,
} from './ast/value-factory.js';
export type {
  ValueObj,
  Dimension,
  Color,
  Quoted,
  Keyword,
  List,
} from './ast/value-eval.js';
