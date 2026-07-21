// Value substrate + fn-authoring surface for `@jesscss/fns`. Append-only.
//
// This is the single, narrow, named contract fns imports from core (`fns → core`,
// one direction). Nothing reachable from this barrel may import `@jesscss/fns`
// (grep-gated) — keeping the edge acyclic. Types are re-exported with `export type`
// so they are provably erased and never forge a runtime edge.

// --- value-domain types (erased) ---
export type {
  ValueObj,
  Value,
  Dimension,
  Color,
  Quoted,
  Keyword,
  Bool,
  Nil,
  List,
  EvalModes,
  PluginHost
} from './ast/value-eval.js';

// --- value constructors + accessors ---
export {
  makeDimension,
  makeColorRgb,
  makeColorHsl,
  makeQuoted,
  makeKeyword,
  makeBool,
  makeList,
  numOf,
  textOf,
  colorHsl,
  colorHslClamped,
  colorRawRgb,
  colorRgbRounded
} from './ast/value-factory.js';

// --- value serializer ---
export { HEX, RGB, HSL, serializeColor, hslToRgb } from './ast/color.js';
export { round } from './ast/round.js';

// --- unit table / conversion ---
export { groupOf, unify, unitFactor } from './ast/value-units.js';

// --- literal materialize / sniff ---
export { parseHex, sniffLiteral } from './ast/literal-tag.js';

// --- color name table ---
export { namedColor } from './ast/color-names.js';

// --- fn-authoring types ---
export type { Fn, FnSpec, ParamSpec, FnCtx, FnIo, Kind } from './ast/functions/types.js';

// --- registry seam ---
export { createFnRegistry } from './ast/value-dispatch.js';
export type { FnRegistry } from './ast/value-dispatch.js';
