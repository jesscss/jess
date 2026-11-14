/*
 * Value substrate + fn-authoring compatibility barrel. Append-only.
 *
 * New function/plugin authoring examples should import this surface from the
 * `@jesscss/core` root. This subpath remains the narrow value-domain barrel for
 * compatibility and for consumers that intentionally want only value helpers.
 * Nothing reachable from this barrel may import `@jesscss/fns` (grep-gated),
 * keeping the dependency edge acyclic. Types are re-exported with `export type`
 * so they are provably erased and never forge a runtime edge.
 */

// --- value-domain types (erased) ---
export type {
  ValueGroup,
  Value,
  Dimension,
  Color,
  Quoted,
  Keyword,
  Arithmetic,
  FunctionCall,
  CallResult,
  Any,
  UrlValue,
  Bool,
  Null,
  List,
  ListSeparator,
  Block,
  Collection,
  CollectionEntry,
  EvalModes,
  PluginHost,
  PluginCallCtx,
  PluginVariableHit,
  PluginRawArgument,
  PluginDetachedRuleset,
  PluginDetachedDeclaration
} from './ast/value-eval.js';

export { DEFAULT_MODES, emitValue, isValueGroup, isValueGroupArray } from './ast/value-eval.js';

// --- value constructors + accessors ---
export {
  makeDimension,
  makeColorRgb,
  makeColorHsl,
  makeQuoted,
  makeKeyword,
  makeAny,
  makeBool,
  makeNull,
  NULL,
  NULL_LITERAL,
  makeList,
  makeBlock,
  makeCollection,
  numOf,
  textOf,
  colorHsl,
  colorHslClamped,
  colorRawRgb,
  colorRgbRounded,
  withFields
} from './ast/value-factory.js';

// --- shared typed-list capabilities ---
export {
  groupItems,
  groupSeparator,
  listValueAt,
  isBracketedList
} from './ast/value-list.js';

// --- value-domain map (Collection) accessors ---
export { CollectionOverlay, isCollection, collectionEntries, collectionEntryIndex, collectionKeyIndex } from './ast/value-collection.js';

// --- value serializer ---
export { HEX, RGB, HSL, holdsNone, serializeColor, hslToRgb } from './ast/color.js';
export { serializeValue } from './ast/serialize-value.js';
export { decimalStep, round } from './ast/round.js';
export { addExact, modExact, mulExact, percentToFraction, subExact } from './ast/decimal.js';

// --- shared value COMPARISON primitive (§5.1) ---
export { compareOrder } from './ast/value-guards.js';

// --- the binary operators (`+ - * /`) every dialect computes with ---
export { operate, ratioOf } from './ast/value-operate.js';
export { operated as operatedOnUnknown } from './ast/math-operand.js';

// --- unit table / conversion ---
export { convertValue, foldUnit, groupOf, isCssUnit, unify, unitFactor } from './ast/value-units.js';

// --- literal materialize / sniff ---
export { parseHex, sniffLiteral, sniffUnnamed, spelledColor, coerceNamedColorKeyword } from './ast/literal-tag.js';

// --- selector values (`&`, `selector.parse()`) ---
export { selectorValue } from './ast/selector-text.js';

// --- color name table ---
export { namedColor } from './ast/color-names.js';

// --- fn-authoring types ---
export type {
  DefinedFunction,
  Fn,
  FnSpec,
  ParamSpec,
  FnCtx,
  FnIo,
  SelectorParse,
  FnRecord,
  FunctionBodyArgs,
  Kind,
  LazyValue,
  ParamInput,
  ParamValue
} from './ast/functions/types.js';

export { TOLERANCE } from './ast/format-number.js';

// --- registry seam ---
export { createFnRegistry, declineOverUnknown, defineFunction, FunctionDeclined, isUnknownNumber } from './ast/value-dispatch.js';
export { NoCssForm } from './ast/value-eval.js';
export type { FnRegistry } from './ast/value-dispatch.js';
