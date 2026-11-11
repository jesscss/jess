import {
  coerceNamedColorKeyword,
  HEX,
  makeAny,
  makeColorRgb,
  makeDimension,
  makeKeyword,
  makeList,
  makeQuoted,
  sniffLiteral,
  type PluginDetachedRuleset,
  type Value,
  type ValueGroup
} from '@jesscss/core';

/*
 * The compiler's values as the Less 4 tree a plugin body reads, and back, each
 * converted once. The tree classes are the script runtime's (`less.tree`), so
 * the runtime hands them in.
 */

type TreeNode = { toCSS(): string };

/** The Less 4 tree classes, as far as a conversion reads or builds them. */
export interface PluginTree {
  Node: abstract new (...args: never[]) => TreeNode;
  Dimension: new (value: number, unit: string) => TreeNode & { value: number; unit: string };
  Color: new (rgb: readonly unknown[], alpha: number, originalForm?: string) => TreeNode & {
    rgb: [number, number, number];
    alpha: number | undefined;
    originalForm: string | undefined;
  };
  Quoted: new (quote: string, value: string, escaped: boolean) => TreeNode & { quote: string; value: unknown; escaped: unknown };
  Anonymous: new (value: string) => TreeNode & { value: unknown };
  Keyword: new (value: string) => TreeNode & { value: unknown };
  Declaration: new (name: string, value: unknown) => TreeNode & { name: unknown; value: unknown };
  Mixin: new (rules: unknown[]) => TreeNode & { ruleset: { rules: unknown[] } };
  Ruleset: abstract new (...args: never[]) => TreeNode & { rules: unknown[] };
  DetachedRuleset: abstract new (...args: never[]) => TreeNode & { ruleset?: { rules: unknown[] } };
  Value: new (value: unknown[], separator: string) => TreeNode & { value: unknown[]; separator: string };
  Expression: new (value: unknown[]) => TreeNode & { value: unknown[] };
}

type LegacyNil = { readonly type: 'Nil'; readonly value: '' };
type LegacyDeclaration = { readonly type: 'Declaration'; readonly name: string; readonly value: ValueGroup; eval(): LegacyDeclaration };

/** A plugin's map (a Mixin, Ruleset or DetachedRuleset) as the compiler reads it: the Less 4 map shape. */
export type LegacyMixin = {
  readonly type: 'Mixin';
  readonly name: LegacyNil;
  readonly args: LegacyNil;
  readonly ruleset: { readonly rules: readonly LegacyDeclaration[] };
  eval(): LegacyMixin;
};

/*
 * Where a plugin value converts back. A list item is always a value: a raw
 * script value becomes its text, and a map is no value. A built-in call's
 * argument (`CALL_ARG`) reads the same way, except that a map stays a map. A
 * whole value (`VALUE`: a script export's result, a map value handed back)
 * passes a raw script value through as it is. A `@plugin` function's own
 * result (`RESULT`) is a `VALUE` that may also be raw `Anonymous` text, which
 * Less 4.x treats as raw text, also valid as a statement.
 */
export const CALL_ARG = 1;
export const VALUE = 2;
export const RESULT = 3;
type Level = typeof CALL_ARG | typeof VALUE | typeof RESULT;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const isValueNode = (value: unknown): value is Value =>
  isRecord(value) && typeof value.type === 'string' && typeof value.bytes === 'string';

const isDetached = (value: unknown): value is PluginDetachedRuleset =>
  isRecord(value) && value.type === 'DetachedRuleset' && Array.isArray(value.rules);

const quoteOf = (quote: unknown): '"' | '\'' => (quote === '\'' ? '\'' : '"');

export const createPluginValues = (tree: PluginTree) => {
  /** A map declaration's `Anonymous` reading aid → the plugin value it stands for. */
  const facadeValues = new WeakMap<object, unknown>();

  /**
   * A map as a Less 4 plugin reads it: a Mixin of declarations. Legacy map
   * helpers read a declaration's `.value.value` as raw CSS text (e.g. "576px")
   * and parseFloat it, so each value is an `Anonymous` of its CSS. That shape
   * is a reading aid, not the value: one a plugin returns unchanged
   * (`theme-color` handing back a map colour) converts back from the value it
   * stands for (`facadeValues`), not from its text.
   */
  const pluginMap = (declarations: ReadonlyArray<{ name: string; value: unknown }>) => new tree.Mixin(declarations.map(({ name, value }) => {
    const decoded = toPluginValue(value, true);
    const carrier = new tree.Anonymous(decoded instanceof tree.Node ? decoded.toCSS() : String(decoded));
    facadeValues.set(carrier, decoded);
    return new tree.Declaration(name, carrier);
  }));

  /** A compiler value given in the Less facade shape (`{ type: 'Dimension', value, unit }`); `undefined` for another shape. */
  const facadePluginValue = (value: Record<string, unknown>): TreeNode | undefined => {
    switch (value.type) {
      case 'Dimension':
        return typeof value.value === 'number' ? new tree.Dimension(value.value, typeof value.unit === 'string' ? value.unit : '') : undefined;
      case 'Color': {
        const { rgb } = value;
        return Array.isArray(rgb) && rgb.length === 3
          ? new tree.Color([rgb[0], rgb[1], rgb[2]], typeof value.alpha === 'number' ? value.alpha : 1, typeof value.bytes === 'string' ? value.bytes : undefined)
          : undefined;
      }
      case 'Quoted':
        return typeof value.value === 'string' ? new tree.Quoted(quoteOf(value.quote), value.value, value.escaped === true) : undefined;
      case 'Anonymous':
      case 'Keyword':
        return typeof value.value === 'string' ? new (value.type === 'Keyword' ? tree.Keyword : tree.Anonymous)(value.value) : undefined;
      case 'Expression':
        return Array.isArray(value.value) ? new tree.Expression(value.value.map(item => toPluginValue(item, true))) : undefined;
      case 'Value':
        return Array.isArray(value.value)
          ? new tree.Value(value.value.map(item => toPluginValue(item, true)), value.separator === '/' || value.separator === ';' ? value.separator : ',')
          : undefined;
      case 'Mixin': {
        const { ruleset } = value;
        return isRecord(ruleset) && Array.isArray(ruleset.rules)
          ? pluginMap(ruleset.rules.flatMap(rule => (isRecord(rule) && rule.type === 'Declaration' && typeof rule.name === 'string'
              ? [{ name: rule.name, value: rule.value }]
              : [])))
          : undefined;
      }
      default:
        return undefined;
    }
  };

  /**
   * A compiler value as the Less 4 tree node a plugin reads. A value with no
   * tree spelling passes through as it is, or, inside a list, as its text.
   */
  function toPluginValue(value: unknown, inList = false): unknown {
    if (Array.isArray(value)) {
      return new tree.Expression(value.map(item => toPluginValue(item, true)));
    }
    if (isValueNode(value)) {
      /* A named colour (`white`) is a Color to a Less 4.x plugin (`{ rgb: [r, g, b] }`). */
      const node = coerceNamedColorKeyword(value);
      switch (node.type) {
        case 'Dimension': return new tree.Dimension(node.number, node.unit ?? '');
        case 'Color': return new tree.Color([node.rgb[0], node.rgb[1], node.rgb[2]], node.alpha ?? 1, node.bytes);
        case 'Quoted': return new tree.Quoted(quoteOf(node.quote), node.value, node.escaped === true);

        /* An escaped string (`~"…"`, `e()`) is an escaped Quoted to a 4.x plugin. */
        case 'Any': return node.escapedQuote === '' ? new tree.Anonymous(node.bytes) : new tree.Quoted(quoteOf(node.escapedQuote), node.bytes, true);
        case 'Keyword':
        case 'Arithmetic':
        case 'FunctionCall': return new tree.Keyword(node.bytes);
        case 'List':
          return node.sep === ',' || node.sep === '/'
            ? new tree.Value(node.value.map(item => toPluginValue(item, true)), node.sep)
            : new tree.Anonymous(node.bytes);
        default: return new tree.Anonymous(node.bytes);
      }
    }
    if (isDetached(value)) {
      return pluginMap(value.rules);
    }
    const facade = isRecord(value) ? facadePluginValue(value) : undefined;
    if (facade !== undefined) {
      return facade;
    }
    return inList ? String(value) : value;
  }

  /*
   * A function result with no CSS spelling (NaN, ±Infinity), or one that
   * could not be data at all (a BigInt, a cycle), is refused at its call: NaN
   * would otherwise read as a declined call or a dropped declaration. While a
   * result converts, `note` keeps the first such fact, in the order the
   * value's parts convert.
   */
  let watching = false;
  let nonFinite: string | null = null;
  let notData = false;

  /** Notes a part of a result that is not finite, or (an object or BigInt) not data. */
  const note = (part: unknown): void => {
    if (!watching) {
      return;
    }
    if (typeof part === 'number') {
      if (nonFinite === null && !Number.isFinite(part)) {
        nonFinite = String(part);
      }
      return;
    }
    if (typeof part === 'bigint') {
      notData = true;
      return;
    }
    if (isRecord(part)) {
      try {
        JSON.stringify(part, (_key, item: unknown) => {
          note(typeof item === 'number' ? item : undefined);
          return item;
        });
      } catch {
        notData = true;
      }
    }
  };

  /**
   * A result converted while watched, and why it cannot be a CSS value (or
   * `null`). A part already noted is the reason, also when the compiler then
   * refuses to make a value of it (`makeDimension(Infinity)` throws).
   */
  const watched = <T>(convert: () => T): { value: T | undefined; why: string | null } => {
    watching = true;
    nonFinite = null;
    notData = false;
    try {
      let value: T | undefined;
      try {
        value = convert();
      } catch (err) {
        if (!notData && nonFinite === null) {
          throw err;
        }
      }
      const why = notData
        ? 'is not JSON-serializable'
        : nonFinite === null ? null : `is ${nonFinite}, which has no CSS spelling`;
      return { value, why };
    } finally {
      watching = false;
    }
  };

  /** A plugin's map (or ruleset) as the Less 4 map shape the compiler reads. */
  const compilerMap = (rules: readonly unknown[]): LegacyMixin => {
    const nil: LegacyNil = { type: 'Nil', value: '' };
    const mixin: LegacyMixin = {
      type: 'Mixin',
      name: nil,
      args: nil,
      ruleset: {
        rules: rules.flatMap((rule): LegacyDeclaration[] => (rule instanceof tree.Declaration && typeof rule.name === 'string'
          ? [{
              type: 'Declaration',
              name: rule.name,
              value: listItem(rule.value),
              eval() {
                return this;
              }
            }]
          : []))
      },
      eval() {
        return mixin;
      }
    };
    return mixin;
  };

  const mapRules = (value: unknown): readonly unknown[] | undefined => {
    if (value instanceof tree.Mixin) {
      return value.ruleset.rules;
    }
    if (value instanceof tree.DetachedRuleset) {
      return value.ruleset?.rules ?? [];
    }
    return value instanceof tree.Ruleset ? value.rules : undefined;
  };

  /** A tree node with a value of its own, as the compiler's value; `undefined` for any other value. */
  const nodeValue = (value: unknown): ValueGroup | undefined => {
    if (value instanceof tree.Dimension) {
      note(value.value);
      return makeDimension(value.value, value.unit || '');
    }
    if (value instanceof tree.Color) {
      note(value.rgb);
      note(value.alpha);
      note(value.originalForm);
      return makeColorRgb(value.rgb, value.alpha ?? 1, HEX, value.originalForm === undefined ? undefined : { src: value.originalForm });
    }
    if (value instanceof tree.Quoted) {
      /*
       * An empty quote character is less.js's "raw text" spelling (bootstrap's
       * escape-svg returns `new tree.Quoted('', str)`); it must not be re-quoted.
       */
      if (value.quote === '') {
        return sniffLiteral(String(value.value));
      }
      note(value.escaped);
      return value.escaped === true ? makeAny(String(value.value), value.quote) : makeQuoted(String(value.value), value.quote, false);
    }
    if (value instanceof tree.Expression) {
      return value.value.map(listItem);
    }
    if (value instanceof tree.Value) {
      return makeList(value.value.map(listItem), value.separator === '/' ? '/' : ',');
    }

    /* Every other tree node is byte-faithful through `toCSS()`, re-read as a typed value. */
    if (value instanceof tree.Node && !(value instanceof tree.Anonymous) && mapRules(value) === undefined) {
      const css = value.toCSS();
      note(css);
      return sniffLiteral(css);
    }
    return undefined;
  };

  /** A plugin value inside a list (or a map), as the compiler's value. */
  function listItem(value: unknown): ValueGroup {
    const carried = isRecord(value) ? facadeValues.get(value) : undefined;
    if (carried !== undefined) {
      return listItem(carried);
    }
    const rules = mapRules(value);
    if (rules !== undefined) {
      /* A map inside a list is no value of its own; its parts are still checked. */
      compilerMap(rules);
      return makeKeyword('');
    }
    if (value instanceof tree.Anonymous) {
      return sniffLiteral(String(value.value));
    }
    const node = nodeValue(value);
    if (node !== undefined) {
      return node;
    }
    const scalar = typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? value : String(value);
    note(scalar);
    return typeof scalar === 'number' ? makeDimension(scalar) : sniffLiteral(String(scalar));
  }

  /** A plugin value as the compiler's value, read as `at` says (`CALL_ARG`, `VALUE`, `RESULT`). */
  function fromPluginValue(value: unknown, at: Level): unknown {
    const carried = isRecord(value) ? facadeValues.get(value) : undefined;
    if (carried !== undefined) {
      return typeof carried === 'string' ? sniffLiteral(carried) : fromPluginValue(carried, VALUE);
    }
    const rules = mapRules(value);
    if (rules !== undefined) {
      return compilerMap(rules);
    }
    if (value instanceof tree.Anonymous) {
      return at === RESULT && value.constructor === tree.Anonymous
        ? { type: 'Anonymous', value: String(value.value) }
        : sniffLiteral(String(value.value));
    }
    const node = nodeValue(value);
    if (node !== undefined) {
      return node;
    }
    if (at === CALL_ARG) {
      return listItem(value);
    }
    note(value);
    return value;
  }

  return { toPluginValue, fromPluginValue, watched };
};
