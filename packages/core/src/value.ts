/*
 * Value substrate + fn-authoring surface for `@jesscss/fns`. Append-only.
 *
 * This is the single, narrow, named contract fns imports from core (`fns → core`,
 * one direction). Nothing reachable from this barrel may import `@jesscss/fns`
 * (grep-gated) — keeping the edge acyclic. Types are re-exported with `export type`
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
  Any,
  Bool,
  Nil,
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

export { emitValue, isValueGroup, isValueGroupArray } from './ast/value-eval.js';

// --- value constructors + accessors ---
export {
  makeDimension,
  makeColorRgb,
  makeColorHsl,
  makeQuoted,
  makeKeyword,
  makeAny,
  makeBool,
  makeNil,
  NIL,
  makeList,
  makeBlock,
  makeCollection,
  numOf,
  textOf,
  colorHsl,
  colorHslClamped,
  colorRawRgb,
  colorRgbRounded
} from './ast/value-factory.js';

// --- shared typed-list capabilities ---
export {
  groupItems,
  groupSeparator,
  listValueAt,
  isBracketedList
} from './ast/value-list.js';

// --- value-domain map (Collection) accessors ---
export { isCollection, collectionEntries, collectionEntryIndex, collectionKeyIndex } from './ast/value-collection.js';

// --- value serializer ---
export { HEX, RGB, HSL, serializeColor, hslToRgb } from './ast/color.js';
export { serializeValue } from './ast/serialize-value.js';
export { round } from './ast/round.js';

// --- unit table / conversion ---
export { groupOf, unify, unitFactor } from './ast/value-units.js';

// --- literal materialize / sniff ---
export { parseHex, sniffLiteral } from './ast/literal-tag.js';

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
  FnRecord,
  PartialFnRecord,
  FunctionArgs,
  FunctionBodyArgs,
  Kind,
  LazyValue,
  ParamInput,
  ParamValue
} from './ast/functions/types.js';

// --- registry seam ---
export { createFnRegistry, defineFunction } from './ast/value-dispatch.js';
export type { FnRegistry } from './ast/value-dispatch.js';
