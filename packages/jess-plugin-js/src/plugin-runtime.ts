// @ts-nocheck
import * as fs from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  coerceNamedColorKeyword,
  makeAny,
  makeColorRgb,
  makeDimension,
  makeKeyword,
  makeList,
  makeQuoted,
  sniffLiteral,
  HEX
} from '@jesscss/core';
import { renderInEngine, warmEngine } from './engine-runtime.js';

const moduleCache = new Map();
const lessPluginRuntimeCache = new Map();

/*
 * The script runtime behind `@jesscss/plugin-js`. It runs only inside the
 * Deno compile engine, where the whole render runs and plugins are called
 * in-process. File access goes through `node:fs`, which Deno checks against
 * its permission flags.
 */

/**
 * Compiles a legacy `@plugin` (CommonJS-shaped) script body with its injected
 * variables as parameters. This only ever runs inside the Deno sandbox.
 */
const compileScript = (params, source) => new Function(...params, source);

/**
 * The Less 4 `Node` base. `find` is the member bootstrap-era plugins reach for
 * through `tree.Variable.prototype.find(frames, cb)`; it is defined here (and
 * inherited) exactly as less.js defines it, so the prototype lookup that those
 * plugins perform resolves to the real helper rather than `undefined`.
 */
class Node {
  eval() {
    return this;
  }

  find(obj, fun) {
    for (let index = 0, result; index < obj.length; index++) {
      result = fun.call(obj, obj[index]);
      if (result) {
        return result;
      }
    }
    return null;
  }

  toCSS() {
    return String(this.value ?? '');
  }

  toString() {
    return this.toCSS();
  }

  valueOf() {
    return this.value;
  }
}

/**
 * Less's unit model, reduced to the single fact plugin authors read or pass on:
 * the unit string. `Dimension` accepts either a plain string or a `Unit`, which
 * is how `new tree.Dimension(next.value - 0.02, next.unit)` keeps its unit.
 */
class Unit extends Node {
  type = 'Unit';

  constructor(numerator) {
    super();
    this.numerator = typeof numerator === 'string'
      ? (numerator ? [numerator] : [])
      : Array.isArray(numerator) ? numerator.slice() : [];
    this.denominator = [];
  }

  clone() {
    return new Unit(this.numerator);
  }

  isEmpty() {
    return this.numerator.length === 0 && this.denominator.length === 0;
  }

  toString() {
    return this.numerator.join('*');
  }

  toCSS() {
    return this.toString();
  }
}

const unitOf = (unit) => {
  if (unit instanceof Unit) {
    return unit.clone();
  }
  return new Unit(unit == null ? '' : String(unit));
};

class Dimension extends Node {
  type = 'Dimension';

  /**
   * Mirrors less.js: the numeric part is `parseFloat`d off `value` and the unit
   * comes only from the second argument. `new tree.Dimension('25%')` is
   * therefore the unitless `25` — the same value less.js produces — not `25%`.
   */
  constructor(value, unit) {
    super();
    this.value = parseFloat(value);
    if (Number.isNaN(this.value)) {
      throw new Error(`Less @plugin: tree.Dimension received a non-numeric value (${JSON.stringify(value)}).`);
    }
    this._unit = unitOf(unit);
  }

  get unit() {
    return this._unit.toString();
  }

  set unit(next) {
    this._unit = unitOf(next);
  }

  valueOf() {
    return this.unit ? `${this.value}${this.unit}` : this.value;
  }

  toString() {
    return String(this.valueOf());
  }

  toCSS() {
    return `${this.value}${this.unit}`;
  }

  /**
   * less.js `Dimension.compare`: numbers are comparable when their units match
   * or when either side is unitless. Anything else is `undefined`, which is the
   * signal bootstrap's `valid-calc` plugin uses to emit a `calc()` instead.
   */
  compare(other) {
    if (!(other instanceof Dimension)) {
      return undefined;
    }
    const a = this.unit;
    const b = other.unit;
    if (a !== b && a !== '' && b !== '') {
      return undefined;
    }
    if (other.value > this.value) {
      return -1;
    }
    return other.value < this.value ? 1 : 0;
  }

  operate(context, op, other) {
    void context;
    if (!(other instanceof Dimension)) {
      throw new Error(`Less @plugin: tree.Dimension.operate("${op}") needs a Dimension operand.`);
    }
    const a = this.unit;
    const b = other.unit;
    if ((op === '+' || op === '-') && a !== b && a !== '' && b !== '') {
      throw new Error(`Less @plugin: incompatible units "${a}" and "${b}" in a "${op}" operation.`);
    }
    const value = op === '+'
      ? this.value + other.value
      : op === '-'
        ? this.value - other.value
        : op === '*'
          ? this.value * other.value
          : op === '/'
            ? this.value / other.value
            : undefined;
    if (value === undefined) {
      throw new Error(`Less @plugin: tree.Dimension.operate does not implement "${op}".`);
    }
    return new Dimension(value, a || b);
  }
}

const clampByte = n => Math.min(255, Math.max(0, Math.round(n)));
const hexPair = n => clampByte(n).toString(16).padStart(2, '0');

class Color extends Node {
  type = 'Color';

  /**
   * less.js accepts an RGB triple OR a hex string WITHOUT the leading `#`
   * (`new tree.Color(someColor.toCSS().substr(1))`), which is precisely the
   * form bootstrap's `theme-color-level` plugin round-trips through.
   *
   * `originalForm` is the authored spelling of a colour that reached the plugin
   * unmodified (`@white: #fff`), mirroring less.js's Color `value`/originalForm:
   * a pass-through keeps its short form, while a plugin-CONSTRUCTED colour has
   * none and serialises to 6-digit hex.
   *
   * An RGB triple keeps its raw channels, as in less.js: a computed colour
   * reaches the plugin unrounded, and only `toCSS` rounds and clamps.
   */
  constructor(rgb, alpha = 1, originalForm) {
    super();
    this.originalForm = typeof originalForm === 'string' ? originalForm : undefined;
    if (Array.isArray(rgb)) {
      this.rgb = rgb.slice(0, 3);
      this.alpha = typeof alpha === 'number' ? alpha : 1;
      return;
    }
    const text = String(rgb).replace(/^#/, '');
    const expanded = text.length >= 6
      ? [text.slice(0, 2), text.slice(2, 4), text.slice(4, 6), text.length >= 8 ? text.slice(6, 8) : undefined]
      : [text[0] + text[0], text[1] + text[1], text[2] + text[2], text[3] ? text[3] + text[3] : undefined];
    const channels = expanded.slice(0, 3).map(pair => parseInt(pair, 16));
    if (channels.some(Number.isNaN)) {
      throw new Error(`Less @plugin: tree.Color received an unparsable hex value (${JSON.stringify(rgb)}).`);
    }
    this.rgb = channels;
    this.alpha = expanded[3] === undefined
      ? (typeof alpha === 'number' ? alpha : 1)
      : parseInt(expanded[3], 16) / 255;
  }

  get value() {
    return this.toCSS();
  }

  /** less.js renders an opaque colour as hex and a translucent one as `rgba()`. */
  toCSS() {
    if (this.originalForm !== undefined) {
      return this.originalForm;
    }
    const [r, g, b] = this.rgb;
    return this.alpha === 1
      ? `#${hexPair(r)}${hexPair(g)}${hexPair(b)}`
      : `rgba(${clampByte(r)}, ${clampByte(g)}, ${clampByte(b)}, ${this.alpha})`;
  }
}

class Quoted extends Node {
  type = 'Quoted';

  constructor(quote, value, escaped = false) {
    super();
    this.quote = quote === undefined ? '"' : String(quote);

    /*
     * less.js: `this.value = content || ''`. `new tree.Quoted('"')` is the empty
     * string, NOT the text "undefined" — bootstrap relies on that for its
     * "no breakpoint" sentinel.
     */
    this.value = value === undefined || value === null ? '' : String(value);
    this.escaped = escaped;
  }

  toCSS() {
    return `${this.escaped ? '~' : ''}${this.quote}${this.value}${this.quote}`;
  }
}

class Anonymous extends Node {
  type = 'Anonymous';

  constructor(value) {
    super();
    this.value = value;
  }

  toCSS() {
    return String(this.value);
  }
}

class Keyword extends Anonymous {
  type = 'Keyword';
}

class Comment extends Anonymous {
  type = 'Comment';
}

class UnicodeDescriptor extends Anonymous {
  type = 'UnicodeDescriptor';
}

class Property extends Node {
  type = 'Property';

  constructor(name) {
    super();
    this.name = name;
    this.value = name;
  }

  toCSS() {
    return String(this.name);
  }
}

/**
 * `tree.Variable` exists so plugins can (a) reach `Variable.prototype.find` —
 * the `Node` helper every bootstrap-era scope lookup goes through — and (b)
 * name a variable for the shim to resolve against the live evaluation frames.
 */
class Variable extends Node {
  type = 'Variable';

  constructor(name, index, currentFileInfo) {
    super();
    this.name = name;
    this.index = index;
    this.currentFileInfo = currentFileInfo;
  }

  eval(context) {
    const frames = context?.frames ?? [];
    for (const frame of frames) {
      const hit = frame.variable?.(this.name);
      if (hit?.value !== undefined) {
        return hit.value;
      }
    }
    throw new Error(`Less @plugin: variable "${this.name}" is undefined.`);
  }

  toCSS() {
    return String(this.name);
  }
}

class Declaration extends Node {
  type = 'Declaration';

  constructor(name, value, important = '') {
    super();
    this.name = name;
    this.value = value;
    this.important = important;
  }

  eval() {
    return this;
  }

  toCSS() {
    const v = this.value?.toCSS ? this.value.toCSS() : String(this.value);
    return `${this.name}: ${v}${this.important}`;
  }
}

class Nil extends Node {
  type = 'Nil';
  value = '';
}

/**
 * A read-only view of a declaration list. Less plugins reach `ruleset.rules`
 * (and `instanceof tree.Declaration` on each entry); a plugin value has no
 * shape for a ruleset's selectors or nesting, so the shim exposes the
 * declaration list only and refuses anything that would need more.
 */
class Ruleset extends Node {
  type = 'Ruleset';

  constructor(selectors, rules) {
    super();
    if (selectors !== undefined && selectors !== null && (!Array.isArray(selectors) || selectors.length > 0)) {
      refuseLessPluginApi('tree.Ruleset with selectors');
    }
    this.selectors = [];
    this.rules = Array.isArray(rules) ? rules : [];
  }
}

class DetachedRuleset extends Node {
  type = 'DetachedRuleset';

  constructor(ruleset) {
    super();
    this.ruleset = ruleset ?? new Ruleset(null, []);
  }
}

/*
 * The legacy-plugin map façade is an anonymous callable Mixin, not a second
 * detached-ruleset value model.  Existing helpers inspect `ruleset.rules` and
 * declaration values; Nil carries the intentionally absent name/args facts.
 */
class Mixin extends Node {
  type = 'Mixin';
  name = new Nil();
  args = new Nil();
  ruleset;

  constructor(rules) {
    super();
    this.ruleset = { rules };
  }
}

class Value extends Node {
  type = 'Value';

  constructor(value, separator = ',') {
    super();
    this.value = value;
    this.separator = separator;
  }

  toCSS() {
    const sep = this.separator === ' ' ? ' ' : `${this.separator} `;
    return this.value.map(item => item?.toCSS ? item.toCSS() : String(item)).join(sep);
  }
}

class Expression extends Value {
  type = 'Expression';

  constructor(value) {
    super(value, ' ');
  }
}

class Paren extends Node {
  type = 'Paren';

  constructor(value) {
    super();
    this.value = value;
  }

  toCSS() {
    return `(${this.value?.toCSS ? this.value.toCSS() : String(this.value)})`;
  }
}

class Negative extends Node {
  type = 'Negative';

  constructor(value) {
    super();
    this.value = value;
  }

  toCSS() {
    return `-${this.value?.toCSS ? this.value.toCSS() : String(this.value)}`;
  }
}

const cssOf = item => (item?.toCSS ? item.toCSS() : String(item));

class Operation extends Node {
  type = 'Operation';

  constructor(op, operands) {
    super();
    this.op = String(op).trim();
    this.operands = operands ?? [];
  }

  eval(context) {
    const [left, right] = this.operands;
    if (left?.operate) {
      return left.operate(context, this.op, right);
    }
    throw new Error(`Less @plugin: tree.Operation cannot evaluate "${this.op}" on this operand.`);
  }

  toCSS() {
    return this.operands.map(cssOf).join(` ${this.op} `);
  }
}

class Call extends Node {
  type = 'Call';

  constructor(name, args) {
    super();
    this.name = name;
    this.args = args ?? [];
  }

  toCSS() {
    return `${this.name}(${this.args.map(cssOf).join(', ')})`;
  }
}

class URL extends Node {
  type = 'Url';

  constructor(value) {
    super();
    this.value = value;
  }

  toCSS() {
    return `url(${cssOf(this.value)})`;
  }
}

class Assignment extends Node {
  type = 'Assignment';

  constructor(key, value) {
    super();
    this.key = key;
    this.value = value;
  }

  toCSS() {
    return `${this.key}=${cssOf(this.value)}`;
  }
}

/**
 * Structural Less 4 nodes with no compiler-value counterpart: a function
 * plugin returns a value, and the rest of the 4.x tree API is the A12 non-goal.
 * Reaching for one is refused like the plugin-manager hooks, and the host
 * reports it as `plugin/unsupported-feature`, whose wording lives in core.
 */
const UNSUPPORTED_TREE_NODES = [
  'AtRule', 'Attribute', 'Combinator', 'Condition', 'Element', 'Extend', 'Import',
  'JavaScript', 'Media', 'MixinCall', 'MixinDefinition', 'NamespaceValue', 'Selector', 'VariableCall'
];

const treeNamespace = {
  Anonymous,
  Assignment,
  Call,
  Color,
  Comment,
  Declaration,
  DetachedRuleset,
  Dimension,
  Expression,
  Keyword,
  Mixin,
  Negative,
  Nil,
  Node,
  Operation,
  Paren,
  Property,
  Quoted,
  Ruleset,
  UnicodeDescriptor,
  Unit,
  URL,
  Value,
  Variable
};

for (const name of UNSUPPORTED_TREE_NODES) {
  Object.defineProperty(treeNamespace, name, {
    enumerable: true,
    configurable: false,
    get: () => refuseLessPluginApi(`tree.${name}`)
  });
}

/**
 * `less.logger` is captured by a plugin at LOAD time but must reach the host
 * diagnostics of whichever CALL is in flight, so the facade's logger forwards to
 * a per-invocation sink installed around each plugin function call.
 */
let activeLogSink = null;

const facadeLogger = {
  warn: message => activeLogSink?.push({ level: 'warn', message: String(message) }),
  error: message => activeLogSink?.push({ level: 'error', message: String(message) }),
  info: message => activeLogSink?.push({ level: 'info', message: String(message) }),
  debug: message => activeLogSink?.push({ level: 'debug', message: String(message) })
};

const lessFacade = {
  tree: treeNamespace,
  logger: facadeLogger
};

/*
 * Less 4.x exposes every `tree` constructor as a lowercase factory on the
 * plugin's `less` object (`less.dimension(1, 'px')`, `less.keyword('a')`). The
 * member is read at call time, so an unsupported node (`less.atrule(…)`) is
 * refused as `tree.AtRule` is.
 */
for (const name of Object.keys(treeNamespace)) {
  lessFacade[name.toLowerCase()] = (...args) => new treeNamespace[name](...args);
}

/**
 * The per-call `less` worker also exposes the facade as a global, as it always
 * has. The compile engine and the in-process runtime do not: there, ESM
 * modules share the realm with the compiler, and a legacy script receives
 * `less` as an injected variable anyway.
 */
export const installLessGlobals = () => {
  globalThis.less ??= lessFacade;
  globalThis.Less ??= lessFacade;
};

/*
 * ---- Plugin values: the compiler's values as the Less 4 tree a plugin body
 * reads, and back. Each crossing converts once, in this realm.
 */

const isRecord = value => typeof value === 'object' && value !== null;
const isValueNode = value => isRecord(value) && typeof value.type === 'string' && typeof value.bytes === 'string';
const isDetached = value => isRecord(value) && value.type === 'DetachedRuleset' && Array.isArray(value.rules);
const quoteOf = quote => (quote === '\'' ? '\'' : '"');

/** A map declaration's `Anonymous` reading aid → the plugin value it stands for. */
const facadeValues = new WeakMap();

/**
 * A map as a Less 4 plugin reads it: a Mixin of declarations. Legacy map
 * helpers read a declaration's `.value.value` as raw CSS text (e.g. "576px")
 * and parseFloat it, so each value is an `Anonymous` of its CSS. That shape is
 * a reading aid, not the value: one a plugin returns unchanged (`theme-color`
 * handing back a map colour) converts back from the value it stands for
 * (`facadeValues`), not from its text.
 */
const pluginMap = declarations => new Mixin(declarations.map(({ name, value }) => {
  const decoded = toPluginValue(value, true);
  const carrier = new Anonymous(decoded?.toCSS ? decoded.toCSS() : String(decoded));
  facadeValues.set(carrier, decoded);
  return new Declaration(name, carrier);
}));

/** A compiler value given in the Less facade shape (`{ type: 'Dimension', value, unit }`); `undefined` for another shape. */
const facadePluginValue = (value) => {
  switch (value.type) {
    case 'Dimension':
      return typeof value.value === 'number' ? new Dimension(value.value, typeof value.unit === 'string' ? value.unit : '') : undefined;
    case 'Color':
      return Array.isArray(value.rgb) && value.rgb.length === 3
        ? new Color([value.rgb[0], value.rgb[1], value.rgb[2]], typeof value.alpha === 'number' ? value.alpha : 1, typeof value.bytes === 'string' ? value.bytes : undefined)
        : undefined;
    case 'Quoted':
      return typeof value.value === 'string' ? new Quoted(quoteOf(value.quote), value.value, value.escaped === true) : undefined;
    case 'Anonymous':
    case 'Keyword':
      return typeof value.value === 'string' ? new (value.type === 'Keyword' ? Keyword : Anonymous)(value.value) : undefined;
    case 'Expression':
      return Array.isArray(value.value) ? new Expression(value.value.map(item => toPluginValue(item, true))) : undefined;
    case 'Value':
      return Array.isArray(value.value)
        ? new Value(value.value.map(item => toPluginValue(item, true)), value.separator === '/' || value.separator === ';' ? value.separator : ',')
        : undefined;
    case 'Mixin':
      return isRecord(value.ruleset) && Array.isArray(value.ruleset.rules)
        ? pluginMap(value.ruleset.rules.filter(rule => isRecord(rule) && rule.type === 'Declaration' && typeof rule.name === 'string'))
        : undefined;
    default:
      return undefined;
  }
};

/**
 * A compiler value as the Less 4 tree node a plugin reads. A value with no
 * tree spelling passes through as it is, or, inside a list, as its text.
 */
const toPluginValue = (value, inList = false) => {
  if (Array.isArray(value)) {
    return new Expression(value.map(item => toPluginValue(item, true)));
  }
  if (isValueNode(value)) {
    /* A named colour (`white`) is a Color to a Less 4.x plugin (`{ rgb: [r, g, b] }`). */
    const node = coerceNamedColorKeyword(value);
    switch (node.type) {
      case 'Dimension': return new Dimension(node.number, node.unit ?? '');
      case 'Color': return new Color([node.rgb[0], node.rgb[1], node.rgb[2]], node.alpha ?? 1, node.bytes);
      case 'Quoted': return new Quoted(quoteOf(node.quote), node.value, node.escaped === true);

      /* An escaped string (`~"…"`, `e()`) is an escaped Quoted to a 4.x plugin. */
      case 'Any': return node.escapedQuote === '' ? new Anonymous(node.bytes) : new Quoted(quoteOf(node.escapedQuote), node.bytes, true);
      case 'Keyword':
      case 'Arithmetic':
      case 'FunctionCall': return new Keyword(node.bytes);
      case 'List':
        return node.sep === ',' || node.sep === '/'
          ? new Value(node.value.map(item => toPluginValue(item, true)), node.sep)
          : new Anonymous(node.bytes);
      default: return new Anonymous(node.bytes);
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
};

/*
 * Where a plugin value converts back. A list item (`IN_LIST`) is always a
 * value: a raw script value becomes its text, and a map is no value. A built-in
 * call's argument (`CALL_ARG`) reads the same way, except that a map stays a
 * map. A whole value (`VALUE`: a script export's result, a map value handed
 * back) passes a raw script value through as it is. A `@plugin` function's own
 * result (`RESULT`) is a `VALUE` that may also be raw `Anonymous` text, which
 * Less 4.x treats as raw text, also valid as a statement.
 */
const IN_LIST = 0;
const CALL_ARG = 1;
const VALUE = 2;
const RESULT = 3;

/*
 * A function result with no CSS spelling (NaN, ±Infinity), or one that could
 * not be data at all (a BigInt, a cycle), is refused at its call: NaN would
 * otherwise read as a declined call or a dropped declaration. While a result
 * converts, `watch` collects the first such fact, in the order the value's
 * parts convert.
 */
const watch = { on: false, nonFinite: null, notData: false };

const isJsonValue = (value) => {
  try {
    JSON.stringify(value);
    return true;
  } catch {
    return false;
  }
};

/** Notes a part of a result that is not finite, or (for an object or BigInt) not data. */
const note = (part) => {
  if (!watch.on) {
    return;
  }
  if (typeof part === 'number') {
    if (watch.nonFinite === null && !Number.isFinite(part)) {
      watch.nonFinite = String(part);
    }
    return;
  }
  if (typeof part === 'bigint') {
    watch.notData = true;
    return;
  }
  if (isRecord(part)) {
    try {
      JSON.stringify(part, (_key, item) => {
        note(typeof item === 'number' ? item : undefined);
        return item;
      });
    } catch {
      watch.notData = true;
    }
  }
};

/**
 * Why a function result cannot be a CSS value, or `null`: `convert` runs while
 * it is watched. A part already noted is the reason, also when the compiler
 * then refuses to make a value of it (`makeDimension(Infinity)` throws).
 */
const watched = (convert) => {
  watch.on = true;
  watch.nonFinite = null;
  watch.notData = false;
  try {
    let value;
    try {
      value = convert();
    } catch (err) {
      if (!watch.notData && watch.nonFinite === null) {
        throw err;
      }
    }
    const why = watch.notData
      ? 'is not JSON-serializable'
      : watch.nonFinite === null ? null : `is ${watch.nonFinite}, which has no CSS spelling`;
    return { value, why };
  } finally {
    watch.on = false;
  }
};

/** A map value a plugin returned unchanged: converted as the value it stands for. */
const fromCarried = (carried, at) => {
  if (at === IN_LIST) {
    return fromPluginValue(carried, IN_LIST);
  }
  return typeof carried === 'string' ? sniffLiteral(carried) : fromPluginValue(carried, VALUE);
};

/** A plugin's map (or ruleset) as the Less 4 map shape the compiler reads. */
const compilerMap = (rules) => {
  const nil = { type: 'Nil', value: '' };
  const mixin = {
    type: 'Mixin',
    name: nil,
    args: nil,
    ruleset: {
      rules: rules.map(rule => ({
        type: 'Declaration',
        name: rule.name,
        value: fromPluginValue(rule.value, IN_LIST),
        eval() {
          return this;
        }
      }))
    },
    eval() {
      return mixin;
    }
  };
  return mixin;
};

/** A Less 4 tree value from a plugin as the compiler's value (see `IN_LIST` … `RESULT`). */
const fromPluginValue = (value, at) => {
  if (value instanceof Dimension) {
    note(value.value);
    note(value.unit || undefined);
    return makeDimension(value.value, value.unit || '');
  }
  if (value instanceof Color) {
    note(value.rgb);
    note(value.alpha);
    note(value.originalForm);
    return makeColorRgb(value.rgb, value.alpha ?? 1, HEX, value.originalForm === undefined ? undefined : { src: value.originalForm });
  }
  if (value instanceof Quoted) {
    /*
     * An empty quote character is less.js's "raw text" spelling (bootstrap's
     * escape-svg returns `new tree.Quoted('', str)`); it must not be re-quoted.
     */
    if (value.quote === '') {
      return sniffLiteral(String(value.value));
    }
    note(value.quote);
    note(value.escaped);
    return value.escaped === true
      ? makeAny(String(value.value), value.quote ?? '"')
      : makeQuoted(String(value.value), value.quote ?? '"', false);
  }
  const carried = facadeValues.get(value);
  if (carried !== undefined) {
    return fromCarried(carried, at);
  }
  if (value instanceof Anonymous) {
    return at === RESULT && value.constructor === Anonymous
      ? { type: 'Anonymous', value: String(value.value) }
      : sniffLiteral(String(value.value));
  }
  if (value instanceof Expression) {
    return value.value.map(item => fromPluginValue(item, IN_LIST));
  }
  if (value instanceof Value) {
    return makeList(value.value.map(item => fromPluginValue(item, IN_LIST)), value.separator === '/' ? '/' : ',');
  }
  if (value instanceof Mixin || value instanceof Ruleset || value instanceof DetachedRuleset) {
    const source = value instanceof Mixin
      ? value.ruleset.rules
      : value instanceof DetachedRuleset ? (value.ruleset?.rules ?? []) : value.rules;
    const map = compilerMap(source.filter(rule => rule instanceof Declaration && typeof rule.name === 'string'));

    /* A map inside a list is no value of its own; its parts are still checked. */
    return at === IN_LIST ? makeKeyword('') : map;
  }

  /* Every other tree node is byte-faithful through `toCSS()`, re-read as a typed value. */
  if (value instanceof Node) {
    const css = value.toCSS();
    note(css);
    return sniffLiteral(css);
  }
  if (at === IN_LIST || at === CALL_ARG) {
    const scalar = typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? value : String(value);
    note(scalar);
    return typeof scalar === 'number' ? makeDimension(scalar) : sniffLiteral(String(scalar));
  }
  note(value);
  return value;
};

/**
 * A loaded script stays loaded for the life of the runtime and is loaded again
 * only when its file changes: the cache entry carries the file's mtime, read
 * with one `stat` per load request. An ES module cannot be evicted from the
 * module map, so a changed one is imported under a new URL (`?v=<mtime>`).
 */
const fileVersion = modulePath => fs.statSync(modulePath).mtimeMs;

const importScript = async (modulePath) => {
  const version = fileVersion(modulePath);
  const cached = moduleCache.get(modulePath);
  if (cached && cached.version === version) {
    return cached.mod;
  }
  const href = pathToFileURL(modulePath).href;
  const mod = await import(cached ? `${href}?v=${version}` : href);
  moduleCache.set(modulePath, { mod, version });
  return mod;
};

export const loadModule = async (modulePath) => {
  const mod = await importScript(modulePath);
  const exports = [];
  for (const [name, value] of Object.entries(mod)) {
    if (typeof value === 'function') {
      exports.push({ name, kind: 'function' as const });
      continue;
    }
    if (isJsonValue(value)) {
      exports.push({ name, kind: 'value' as const, value });
    }
  }
  return exports;
};

/**
 * A refusal of the Less 4 plugin-manager API, or of a tree node beyond the
 * function-plugin value surface, which v5 deliberately does not provide (A12).
 * The message is only the member refused (`pluginManager.addVisitor()`,
 * `less.visitors`, `tree.AtRule`, ...): the host turns it into a `plugin/unsupported-feature`
 * diagnostic whose wording and replacement come from `@jesscss/core`, the same
 * one the in-process bridge of `@jesscss/plugin-less-compat` reports.
 */
class UnsupportedLessPluginApiError extends Error {
  constructor(feature) {
    super(feature);
    this.name = 'UnsupportedLessPluginApiError';
  }
}

const refuseLessPluginApi = (feature) => {
  throw new UnsupportedLessPluginApiError(feature);
};

const refusedGetters = (owner, members) => Object.fromEntries(members.map(member =>
  [member, { get: () => refuseLessPluginApi(`${owner}.${member}`) }]));

/*
 * 4.x plugins reach these before the hook call (`new less.visitors.Visitor(this)`).
 * The worker-global `less` / `Less` refuses them too, so every view of the
 * facade does. The getters are non-enumerable, so spreading the facade skips them.
 */
const REFUSED_LESS_MEMBERS = refusedGetters('less', ['visitors', 'FileManager', 'environment']);
Object.defineProperties(lessFacade, REFUSED_LESS_MEMBERS);

/** The `less` a plugin, and every file it requires, sees: the facade plus its function registry. */
const createPluginLess = functionRegistry =>
  Object.defineProperties({ ...lessFacade, functions: { functionRegistry } }, REFUSED_LESS_MEMBERS);

/* The 4.x PluginManager members that add, list or expose what v5 never runs. */
const REFUSED_MANAGER_METHODS = [
  'addVisitor', 'getVisitors', 'visitor',
  'addPreProcessor', 'getPreProcessors',
  'addPostProcessor', 'getPostProcessors',
  'addFileManager', 'getFileManagers'
];
const REFUSED_MANAGER_FIELDS = refusedGetters('pluginManager', ['visitors', 'iterator', 'preProcessors', 'postProcessors', 'fileManagers', 'Loader']);

/**
 * The Less 4 `PluginManager` (`less/lib/less/plugin-manager.js`): installing
 * plugins works as in 4.x; every hook member is refused.
 */
const createPluginManager = (less) => {
  const pluginCache = {};
  const manager = {
    less,
    installedPlugins: [],
    pluginCache,
    addPlugins(plugins) {
      for (const plugin of Array.from(plugins ?? [])) {
        manager.addPlugin(plugin);
      }
    },
    addPlugin(plugin, filename, functionRegistry) {
      manager.installedPlugins.push(plugin);
      if (filename) {
        pluginCache[filename] = plugin;
      }
      plugin.install?.(less, manager, functionRegistry ?? less.functions.functionRegistry);
    },
    get: filename => pluginCache[filename]
  };
  for (const member of REFUSED_MANAGER_METHODS) {
    manager[member] = () => refuseLessPluginApi(`pluginManager.${member}()`);
  }
  return Object.defineProperties(manager, REFUSED_MANAGER_FIELDS);
};

/* Node's file and directory lookup, minus `.node` addons and package.json `main`. */
const REQUIRE_SUFFIXES = ['', '.js', '.json', '/index.js', '/index.json'];

const isRequirableFile = candidate => fs.statSync(candidate, { throwIfNoEntry: false })?.isFile() === true;

/**
 * `require()` for a legacy `@plugin` file: RELATIVE specifiers only, resolved
 * against the requiring file as Node resolves a file path. Every stat and read
 * is checked by the sandbox's read permission, as the plugin file's own read
 * is, so a require can never reach past the read set. A `.json` file is parsed. Any other
 * required file is plain CommonJS: it gets `module`, `exports`, `require`,
 * `__filename`, `__dirname` and the plugin's own `less` (so its hook refusals
 * and function registry too), not the other plugin globals, and no Node
 * `process`. Each file evaluates once per load, and is cached before it runs,
 * so a require cycle sees partial exports (as in Node).
 */
const createLegacyRequire = (fromPath, cache, less) => (specifier) => {
  const request = String(specifier);
  if (!request.startsWith('./') && !request.startsWith('../')) {
    throw new Error(`Less @plugin require("${request}") is not supported: only relative requires ("./file", "../file") of CommonJS files inside the script root are.`);
  }
  let resolved;
  try {
    /*
     * Resolve from the requiring file's real path, as Node does: the read
     * check compares canonical paths, and a candidate that does not exist cannot be
     * canonicalized, so under a symlinked read root it would read as outside.
     */
    const base = resolve(dirname(fs.realpathSync(fromPath)), request);
    resolved = REQUIRE_SUFFIXES.map(suffix => base + suffix).find(isRequirableFile);
  } catch (err) {
    throw new Error(`Less @plugin require("${request}") from "${fromPath}" was refused: ${err?.message ?? String(err)}`);
  }
  if (resolved === undefined) {
    throw new Error(`Less @plugin require("${request}"): no file found from "${fromPath}".`);
  }
  let module = cache.get(resolved);
  if (!module) {
    module = { exports: {} };
    cache.set(resolved, module);
    const source = fs.readFileSync(resolved, 'utf8');
    if (resolved.endsWith('.json')) {
      module.exports = JSON.parse(source);
      return module.exports;
    }
    compileScript(['module', 'exports', 'require', '__filename', '__dirname', 'process', 'less'], source)(
      module,
      module.exports,
      createLegacyRequire(resolved, cache, less),
      resolved,
      dirname(resolved),
      undefined,
      less
    );
  }
  return module.exports;
};

/*
 * Deprecated Less @plugin support only. Jess @-use is plain ESM and must not
 * pass through this injected-variable wrapper.
 */
const createLegacyLessPluginRuntime = (modulePath, options) => {
  const localFunctions = new Map();
  const functions = {
    add(name, fn) {
      if (typeof name === 'string' && typeof fn === 'function') {
        localFunctions.set(name.toLowerCase(), fn);
      }
    },
    addMultiple(items) {
      for (const [name, fn] of Object.entries(items ?? {})) {
        this.add(name, fn);
      }
    },
    get(name) {
      return localFunctions.get(String(name).toLowerCase());
    }
  };
  const less = createPluginLess(functions);
  const manager = createPluginManager(less);
  const installPlugin = (plugin) => {
    if (!plugin) {
      return;
    }
    const candidate = typeof plugin === 'function'
      ? (() => {
          try {
            return new plugin();
          } catch {
            return plugin;
          }
        })()
      : plugin;
    if (candidate && options != null && typeof candidate.setOptions === 'function') {
      candidate.setOptions(options);
    }

    /* As 4.x's loader does: the plugin is installed, and cached under its file. */
    manager.addPlugin(candidate, modulePath);
    if (candidate && options != null && typeof candidate.setOptions === 'function') {
      candidate.setOptions(options);
    }

    /*
     * `use` and `eval` are Less plugin lifecycle hooks. A plugin that fails in
     * either is broken, and Less rejects the compile — so they run here, and a
     * throw propagates out of the load as a real, attributable failure rather
     * than being quietly skipped.
     */
    if (candidate && typeof candidate.use === 'function') {
      candidate.use(less);
    }
    if (candidate && typeof candidate.eval === 'function') {
      candidate.eval(less);
    }
  };
  return {
    exports: {},
    functions,
    localFunctions,
    less,
    manager,
    require: createLegacyRequire(modulePath, new Map(), less),
    registerPlugin: installPlugin,
    fileInfo: { filename: modulePath }
  };
};

const lessPluginCacheKey = (modulePath, options) => `${modulePath}\u0000${options ?? ''}`;

export const loadLessPlugin = async (modulePath: string, options: string | null = null) => {
  const cacheKey = lessPluginCacheKey(modulePath, options);
  const version = fileVersion(modulePath);
  const cached = lessPluginRuntimeCache.get(cacheKey);
  if (cached && cached.version === version) {
    return Array.from(cached.localFunctions.keys());
  }
  const source = fs.readFileSync(modulePath, 'utf8');
  const runtime = createLegacyLessPluginRuntime(modulePath, options);
  runtime.version = version;
  const module = { exports: runtime.exports };
  const loader = compileScript(
    ['module', 'exports', 'require', 'registerPlugin', 'functions', 'tree', 'less', 'fileInfo', 'process'],
    source
  );
  loader(
    module,
    module.exports,
    runtime.require,
    runtime.registerPlugin,
    runtime.functions,
    lessFacade.tree,
    runtime.less,
    runtime.fileInfo,
    undefined
  );
  const exported = module.exports?.default ?? module.exports;
  if (typeof exported === 'function' || (exported && typeof exported.install === 'function')) {
    runtime.registerPlugin(exported);
  }
  lessPluginRuntimeCache.set(cacheKey, runtime);
  return Array.from(runtime.localFunctions.keys());
};

/*
 * The host learns a plugin's function names when the plugin loads, so a
 * function or plugin added from inside a function body would never be callable.
 */
const refuseRegistrationInBody = () => {
  throw new Error('Less @plugin: functions and plugins can only be added while the plugin loads, not from inside a function body.');
};

/** A variable the live call site resolved, as a plugin body reads it from `frame.variable()`. */
const liveVariable = entry => (entry === null || entry === undefined
  ? null
  : { value: toPluginValue(entry.value), important: entry.important ? '!important' : '' });

const liveCall = (fnName, answer) => {
  if (answer === null || answer === undefined) {
    throw new Error(`Less @plugin: built-in function "${fnName}" could not be evaluated with these arguments.`);
  }
  return toPluginValue(answer);
};

/**
 * The `this` a Less 4 plugin function body expects: `this.context` with
 * `frames` / `importantScope` / `pluginManager`, plus `this.currentFileInfo`.
 * Without it the body's `this` is the sandbox global and every `this.context`
 * read is `undefined`. The `pluginManager` is the one the plugin was installed
 * with, its `less` serving built-ins from the live call site.
 *
 * One is built per plugin and reused by its calls; `enter` gives each call its
 * own facts, frames and `importantScope`, so an `!important` one call marks
 * never reaches the next. A call that starts while another is still awaiting
 * gets a site of its own.
 */
const createCallSite = (manager) => {
  let facts;

  /* The live call site answers: the script and the compiler share the engine's realm. */
  const frame = {
    variable(name) {
      return liveVariable(facts.variable(String(name)));
    },
    property() {
      return null;
    },
    functionRegistry: null
  };

  const functionRegistry = {
    get(name) {
      const fnName = String(name);
      return (...callArgs) => liveCall(fnName, facts.call(fnName, callArgs.map(arg => fromPluginValue(arg, CALL_ARG))));
    },
    add: refuseRegistrationInBody
  };

  /*
   * Built on first read: it copies the whole facade, and most plugin bodies
   * use the `less` they were installed with instead of this one.
   */
  let less;
  const pluginManager = Object.create(manager, {
    less: { get: () => (less ??= createPluginLess(functionRegistry)) },
    addPlugin: { value: refuseRegistrationInBody },
    addPlugins: { value: refuseRegistrationInBody }
  });

  const context = {
    frames: null,
    importantScope: null,
    pluginManager,
    compress: false,
    numPrecision: 8
  };
  const self = {
    context,
    currentFileInfo: null,
    index: 0,
    importantScope: null,
    pluginManager
  };

  return {
    busy: false,
    enter(callFacts) {
      facts = callFacts;
      const importantScope = [{ important: '' }];
      context.frames = [frame];
      context.importantScope = importantScope;
      context.pluginManager = pluginManager;
      context.compress = false;
      context.numPrecision = 8;
      self.context = context;
      self.currentFileInfo = callFacts.fileInfo ?? { filename: '', entryPath: '' };
      self.index = 0;
      self.importantScope = importantScope;
      self.pluginManager = pluginManager;
      this.busy = true;
      return self;
    }
  };
};

const callSiteFor = (runtime) => {
  const cached = runtime.callSite;
  if (cached !== undefined && !cached.busy) {
    return cached;
  }
  const site = createCallSite(runtime.manager);
  runtime.callSite ??= site;
  return site;
};

export const invokeLessPluginFunction = async (modulePath: string, functionName: string, args: readonly unknown[], options: string | null, facts: object) => {
  const cacheKey = lessPluginCacheKey(modulePath, options);
  if (!lessPluginRuntimeCache.has(cacheKey)) {
    await loadLessPlugin(modulePath, options);
  }
  const runtime = lessPluginRuntimeCache.get(cacheKey);
  const fn = runtime?.localFunctions.get(String(functionName).toLowerCase());
  if (typeof fn !== 'function') {
    throw new Error(`Less @plugin function "${functionName}" is not registered.`);
  }
  const logs = [];
  const site = callSiteFor(runtime);
  const callContext = site.enter(facts);
  const { importantScope } = callContext;
  const previousSink = activeLogSink;
  activeLogSink = logs;
  let raw;
  try {
    raw = await fn.apply(callContext, args.map(arg => toPluginValue(arg)));
  } finally {
    activeLogSink = previousSink;
    site.busy = false;
  }
  const { value, why } = watched(() => fromPluginValue(raw, RESULT));
  if (why !== null) {
    throw new Error(`Result for Less @plugin function "${functionName}" ${why}.`);
  }
  return {
    value,
    logs,
    important: importantScope.some(entry => Boolean(entry?.important))
  };
};

export const invokeExport = async (modulePath, exportName, args) => {
  const mod = await importScript(modulePath);
  const target = mod?.[exportName];
  if (typeof target !== 'function') {
    throw new Error(`Export "${exportName}" is not callable.`);
  }
  const raw = await target(...args.map(arg => toPluginValue(arg)));
  const { value, why } = watched(() => fromPluginValue(raw, VALUE));
  if (why !== null) {
    throw new Error(`Result for "${exportName}" ${why}.`);
  }
  return value;
};

export const computeResponse = async (req) => {
  try {
    if (req.type === 'render') {
      return { id: req.id, ...(await renderInEngine(req)) };
    }
    if (req.type === 'warm') {
      return { id: req.id, ...(await warmEngine(req)) };
    }
    return { id: req.id, ok: false, error: `Unknown request type "${req.type}".` };
  } catch (err) {
    /* A failure outside the render itself (the request, the engine): reported with its stack. */
    return {
      id: req.id,
      ok: false,
      error: err?.message ?? String(err),
      errorName: err?.name ?? 'Error',
      stack: typeof err?.stack === 'string' ? err.stack : undefined
    };
  }
};
