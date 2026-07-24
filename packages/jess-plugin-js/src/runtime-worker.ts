// @ts-nocheck
/* eslint-disable @typescript-eslint/naming-convention */
import { pathToFileURL } from 'node:url';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const moduleCache = new Map();
const lessPluginFunctionCache = new Map();
const runtimeApi = Deno.args.includes('--runtime-api=less') ? 'less' : 'module';

/**
 * A deliberate, attributable failure for a `less.tree` member the Jess
 * compatibility shim cannot honour. Structural Less 4 nodes (rulesets,
 * selectors, at-rules, imports, extends) have no representation on the value
 * bridge that carries plugin results back to the engine, so exposing a
 * look-alike constructor would silently produce wrong CSS. Throwing names the
 * member and points at the supported surface instead.
 */
class UnsupportedTreeNodeError extends Error {
  constructor(name, reason) {
    super(
      `Less @plugin: "tree.${name}" is not supported by the Jess less-compat shim.\n`
      + `${reason}\n`
      + 'Supported members: Node, Anonymous, Keyword, Quoted, Dimension, Unit, Color, '
      + 'Expression, Value, Declaration, Variable, Property, Operation, Paren, Negative, '
      + 'Call, URL, Comment, Assignment, UnicodeDescriptor, Ruleset, DetachedRuleset, Mixin, Nil.'
    );
    this.name = 'UnsupportedTreeNodeError';
  }
}

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
   */
  constructor(rgb, alpha = 1) {
    super();
    if (Array.isArray(rgb)) {
      this.rgb = rgb.slice(0, 3).map(clampByte);
      this.alpha = typeof alpha === 'number' ? alpha : 1;
      return;
    }
    const text = String(rgb).replace(/^#/, '');
    const expanded = text.length >= 6
      ? [text.slice(0, 2), text.slice(2, 4), text.slice(4, 6), text.slice(6, 8)]
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
    // less.js: `this.value = content || ''`. `new tree.Quoted('"')` is the empty
    // string, NOT the text "undefined" — bootstrap relies on that for its
    // "no breakpoint" sentinel.
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
 * (and `instanceof tree.Declaration` on each entry); nothing on the value
 * bridge can express a ruleset's selectors or nesting, so the shim exposes the
 * declaration list only and refuses anything that would need more.
 */
class Ruleset extends Node {
  type = 'Ruleset';

  constructor(selectors, rules) {
    super();
    if (selectors !== undefined && selectors !== null && (!Array.isArray(selectors) || selectors.length > 0)) {
      throw new UnsupportedTreeNodeError(
        'Ruleset',
        'A selector-bearing ruleset cannot cross the plugin value boundary; only an anonymous declaration list can.'
      );
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

// The legacy-plugin map façade is an anonymous callable Mixin, not a second
// detached-ruleset value model.  Existing helpers inspect `ruleset.rules` and
// declaration values; Nil carries the intentionally absent name/args facts.
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
 * Structural Less 4 nodes with no value-bridge representation. Each is exposed
 * as a constructor that fails loudly and names itself, so a 4.x plugin reaching
 * for one gets an attributable error instead of a silently wrong value.
 */
const UNSUPPORTED_TREE_NODES = {
  AtRule: 'At-rules are statements, not values; a plugin function can only return a value.',
  Attribute: 'Attribute selectors are part of selector structure, which the value bridge does not carry.',
  Combinator: 'Combinators are part of selector structure, which the value bridge does not carry.',
  Condition: 'Guard conditions are evaluated by the engine, not reconstructed by a plugin.',
  Element: 'Selector elements are part of selector structure, which the value bridge does not carry.',
  Extend: ':extend is resolved by the engine\'s extend pass, not by plugin values.',
  Import: '@import is resolved during document loading, before plugin functions run.',
  JavaScript: 'Inline JavaScript evaluation was removed in Jess; use an @plugin function instead.',
  Media: '@media is a statement, not a value; a plugin function can only return a value.',
  MixinCall: 'Mixin calls are dispatched by the engine, not constructed by plugin values.',
  MixinDefinition: 'Mixin definitions are statements, not values.',
  NamespaceValue: 'Namespace lookups are resolved by the engine\'s scope walk.',
  Selector: 'Selectors are part of statement structure, which the value bridge does not carry.',
  VariableCall: 'Detached-ruleset calls are dispatched by the engine, not by plugin values.'
};

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

for (const [name, reason] of Object.entries(UNSUPPORTED_TREE_NODES)) {
  Object.defineProperty(treeNamespace, name, {
    enumerable: true,
    configurable: false,
    get() {
      throw new UnsupportedTreeNodeError(name, reason);
    }
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
  logger: facadeLogger,
  dimension(value, unit) {
    return new Dimension(value, unit);
  },
  value(values, separator = ',') {
    return new Value(values, separator);
  },
  anonymous(value) {
    return new Anonymous(value);
  },
  color(rgb, alpha) {
    return new Color(rgb, alpha);
  },
  quoted(quote, value, escaped = false) {
    return new Quoted(quote, value, escaped);
  }
};

if (runtimeApi === 'less') {
  globalThis.less ??= lessFacade;
  globalThis.Less ??= lessFacade;
}

const isBridgeValue = value =>
  value
  && typeof value === 'object'
  && value.__jessBridge === true
  && typeof value.kind === 'string';

const decodeBridgeValue = (value) => {
  if (!isBridgeValue(value)) {
    return value;
  }
  switch (value.kind) {
    case 'scalar':
      return value.value;
    case 'dimension':
      return new Dimension(value.value, value.unit ?? '');
    case 'color':
      return new Color(value.rgb, value.alpha ?? 1);
    case 'quoted':
      return new Quoted(value.quote ?? '"', value.value, value.escaped === true);
    case 'anonymous':
      return new Anonymous(value.value);
    case 'list':
      return new Value((value.items ?? []).map(decodeBridgeValue), value.separator ?? ',');
    case 'expression':
      return new Expression((value.items ?? []).map(decodeBridgeValue));
    case 'mixin': {
      const rules = (value.rules ?? []).map((decl) => {
        const decoded = decodeBridgeValue(decl.value);
        // Legacy Less @plugin map helpers read the declaration's `.value.value`
        // as the raw CSS string (e.g. "576px"), then parseFloat it. Mirror the
        // less.js Anonymous shape so that access pattern keeps working.
        const cssText = decoded?.toCSS ? decoded.toCSS() : String(decoded);
        return new Declaration(decl.name, new Anonymous(cssText));
      });
      return new Mixin(rules);
    }
    default:
      return value;
  }
};

const encodeBridgeChildValue = (value) => {
  const encoded = encodeBridgeValue(value);
  if (isBridgeValue(encoded)) {
    return encoded;
  }
  return {
    __jessBridge: true,
    kind: 'scalar',
    value: typeof encoded === 'string' || typeof encoded === 'number' || typeof encoded === 'boolean'
      ? encoded
      : String(encoded)
  };
};

const encodeBridgeValue = (value) => {
  if (value instanceof Dimension) {
    return {
      __jessBridge: true,
      kind: 'dimension',
      value: value.value,
      unit: value.unit || undefined
    };
  }
  if (value instanceof Color) {
    return {
      __jessBridge: true,
      kind: 'color',
      rgb: value.rgb,
      alpha: value.alpha
    };
  }
  if (value instanceof Quoted) {
    // An empty quote character is less.js's "raw text" spelling (bootstrap's
    // escape-svg returns `new tree.Quoted('', str)`); it must not be re-quoted.
    return value.quote === ''
      ? { __jessBridge: true, kind: 'anonymous', value: String(value.value) }
      : {
          __jessBridge: true,
          kind: 'quoted',
          value: String(value.value),
          quote: value.quote,
          escaped: value.escaped
        };
  }
  if (value instanceof Keyword || value instanceof Anonymous) {
    return {
      __jessBridge: true,
      kind: 'anonymous',
      value: String(value.value)
    };
  }
  if (value instanceof Expression) {
    return {
      __jessBridge: true,
      kind: 'expression',
      items: value.value.map(encodeBridgeChildValue)
    };
  }
  if (value instanceof Value) {
    return {
      __jessBridge: true,
      kind: 'list',
      items: value.value.map(encodeBridgeChildValue),
      separator: value.separator === '/' || value.separator === ';' ? value.separator : ','
    };
  }
  if (value instanceof Mixin || value instanceof Ruleset || value instanceof DetachedRuleset) {
    const source = value instanceof Mixin
      ? value.ruleset.rules
      : value instanceof DetachedRuleset ? (value.ruleset?.rules ?? []) : value.rules;
    const rules = source
      .filter(rule => rule instanceof Declaration && typeof rule.name === 'string')
      .map(rule => ({ name: rule.name, value: encodeBridgeChildValue(rule.value) }));
    return { __jessBridge: true, kind: 'mixin', rules };
  }
  // Every remaining shim node is byte-faithful through `toCSS()`; the engine
  // re-sniffs those bytes into a typed value on the host side.
  if (value instanceof Node) {
    return { __jessBridge: true, kind: 'anonymous', value: value.toCSS() };
  }
  return value;
};

const isJsonValue = (value) => {
  try {
    JSON.stringify(value);
    return true;
  } catch {
    return false;
  }
};

const send = (payload) => {
  Deno.stdout.writeSync(encoder.encode(`${JSON.stringify(payload)}\n`));
};

const loadModule = async (modulePath) => {
  let mod = moduleCache.get(modulePath);
  if (!mod) {
    const href = pathToFileURL(modulePath).href;
    mod = await import(href);
    moduleCache.set(modulePath, mod);
  }
  const exports = [];
  for (const [name, value] of Object.entries(mod)) {
    if (typeof value === 'function') {
      exports.push({ name, kind: 'function' });
      continue;
    }
    if (isJsonValue(value)) {
      exports.push({ name, kind: 'value', value });
    }
  }
  return exports;
};

// Deprecated Less @plugin support only. Jess @-use is plain ESM and must not
// pass through this injected-variable wrapper.
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
  const manager = {
    visitors: [],
    addVisitor(visitor) {
      this.visitors.push(visitor);
    },
    addPreProcessor() {},
    addPostProcessor() {},
    registerPlugin(plugin) {
      installPlugin(plugin);
    }
  };
  const less = {
    ...lessFacade,
    functions: {
      functionRegistry: functions
    }
  };
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
    if (candidate && typeof candidate.install === 'function') {
      candidate.install(less, manager, functions);
    }
    if (candidate && options != null && typeof candidate.setOptions === 'function') {
      candidate.setOptions(options);
    }
    // `use` and `eval` are Less plugin lifecycle hooks. A plugin that fails in
    // either is broken, and Less rejects the compile — so they run here, and a
    // throw propagates out of the load as a real, attributable failure rather
    // than being quietly skipped.
    if (candidate && typeof candidate.use === 'function') {
      candidate.use(less);
    }
    if (candidate && typeof candidate.eval === 'function') {
      candidate.eval(less);
    }
  };
  const require = (specifier) => {
    throw new Error(`Less @plugin require("${specifier}") is not supported in the Deno sandbox yet.`);
  };
  const registerPlugin = (plugin) => {
    installPlugin(plugin);
  };
  return {
    exports: {},
    functions,
    localFunctions,
    manager,
    require,
    registerPlugin,
    fileInfo: { filename: modulePath }
  };
};

const lessPluginCacheKey = (modulePath, options) => `${modulePath}\u0000${options ?? ''}`;

const loadLessPlugin = async (modulePath, options = null) => {
  const cacheKey = lessPluginCacheKey(modulePath, options);
  let functions = lessPluginFunctionCache.get(cacheKey);
  if (functions) {
    return Array.from(functions.keys());
  }
  const source = await Deno.readTextFile(modulePath);
  const runtime = createLegacyLessPluginRuntime(modulePath, options);
  const module = { exports: runtime.exports };
  const loader = new Function(
    'module',
    'exports',
    'require',
    'registerPlugin',
    'functions',
    'tree',
    'less',
    'fileInfo',
    'process',
    source
  );
  loader(
    module,
    module.exports,
    runtime.require,
    runtime.registerPlugin,
    runtime.functions,
    lessFacade.tree,
    {
      ...lessFacade,
      functions: {
        functionRegistry: runtime.functions
      }
    },
    runtime.fileInfo,
    undefined
  );
  const exported = module.exports?.default ?? module.exports;
  if (typeof exported === 'function' || (exported && typeof exported.install === 'function')) {
    runtime.registerPlugin(exported);
  }
  functions = runtime.localFunctions;
  lessPluginFunctionCache.set(cacheKey, functions);
  return Array.from(functions.keys());
};

/**
 * The sandbox cannot call back into the compiler synchronously, but a Less 4
 * plugin body reads scope (`frames[i].variable('@x')`) and built-in functions
 * (`functionRegistry.get('mix')`) synchronously. Rather than eagerly shipping
 * the whole variable scope on every call, an unsatisfied read raises this
 * signal: the worker reports exactly what it needs, the host resolves it
 * against the LIVE evaluation frame, and the call is replayed with the answer
 * in hand. The host remembers which names a given function asked for, so after
 * the first call the needed facts travel with the request and no replay occurs.
 */
class HostFactNeeded {
  constructor(need) {
    this.need = need;
  }
}

const hostCallKey = (name, args) => `${String(name).toLowerCase()} ${JSON.stringify(args)}`;

/**
 * Builds the `this` a Less 4 plugin function body expects: `this.context` with
 * `frames` / `importantScope` / `pluginManager`, plus `this.currentFileInfo`.
 * Without this the body's `this` is the sandbox global and every `this.context`
 * read is `undefined`.
 */
const createPluginCallContext = (facts, logs) => {
  const importantScope = [{ important: '' }];

  const frame = {
    /**
     * Answers from the host-resolved snapshot for this call. A name the host
     * already reported as unbound resolves to `null` (less.js's "no such
     * variable" answer); anything not yet known raises a fact request.
     */
    variable(name) {
      const key = String(name);
      if (!Object.prototype.hasOwnProperty.call(facts.vars, key)) {
        throw new HostFactNeeded({ kind: 'variable', name: key });
      }
      const entry = facts.vars[key];
      if (entry === null || entry === undefined) {
        return null;
      }
      return { value: decodeBridgeValue(entry.value), important: entry.important ? '!important' : '' };
    },
    property() {
      return null;
    },
    functionRegistry: null
  };

  const functionRegistry = {
    get(name) {
      const fnName = String(name);
      return (...callArgs) => {
        const encoded = callArgs.map(encodeBridgeChildValue);
        const key = hostCallKey(fnName, encoded);
        if (!Object.prototype.hasOwnProperty.call(facts.calls, key)) {
          throw new HostFactNeeded({ kind: 'call', name: fnName, args: encoded, key });
        }
        const answer = facts.calls[key];
        if (answer === null || answer === undefined) {
          throw new Error(`Less @plugin: built-in function "${fnName}" could not be evaluated with these arguments.`);
        }
        return decodeBridgeValue(answer);
      };
    },
    add() {
      throw new Error('Less @plugin: functions cannot be registered from inside a function body.');
    }
  };

  void logs;
  const pluginManager = {
    less: {
      ...lessFacade,
      functions: { functionRegistry }
    },
    getPreProcessors: () => [],
    getPostProcessors: () => [],
    getVisitors: () => [],
    getFileManagers: () => []
  };

  const context = {
    frames: [frame],
    importantScope,
    pluginManager,
    compress: false,
    numPrecision: 8
  };

  return {
    context,
    currentFileInfo: facts.fileInfo ?? { filename: '', entryPath: '' },
    index: 0,
    importantScope,
    pluginManager
  };
};

const invokeLessPluginFunction = async (modulePath, functionName, args, options = null, facts = null) => {
  const cacheKey = lessPluginCacheKey(modulePath, options);
  let functions = lessPluginFunctionCache.get(cacheKey);
  if (!functions) {
    await loadLessPlugin(modulePath, options);
    functions = lessPluginFunctionCache.get(cacheKey);
  }
  const fn = functions?.get(String(functionName).toLowerCase());
  if (typeof fn !== 'function') {
    throw new Error(`Less @plugin function "${functionName}" is not registered.`);
  }
  const logs = [];
  const resolved = facts ?? { vars: {}, calls: {}, fileInfo: null };
  const callContext = createPluginCallContext(resolved, logs);
  const previousSink = activeLogSink;
  activeLogSink = logs;
  let raw;
  try {
    raw = await fn.apply(callContext, args.map(decodeBridgeValue));
  } catch (err) {
    if (err instanceof HostFactNeeded) {
      return { need: err.need, logs };
    }
    throw err;
  } finally {
    activeLogSink = previousSink;
  }
  const result = encodeBridgeValue(raw);
  if (!isJsonValue(result)) {
    throw new Error(`Result for Less @plugin function "${functionName}" is not JSON-serializable.`);
  }
  return {
    value: result,
    logs,
    important: callContext.importantScope.some(entry => Boolean(entry?.important))
  };
};

const invokeExport = async (modulePath, exportName, args) => {
  const mod = moduleCache.get(modulePath) ?? await import(pathToFileURL(modulePath).href);
  moduleCache.set(modulePath, mod);
  const target = mod?.[exportName];
  if (typeof target !== 'function') {
    throw new Error(`Export "${exportName}" is not callable.`);
  }
  const result = encodeBridgeValue(await target(...args.map(decodeBridgeValue)));
  if (!isJsonValue(result)) {
    throw new Error(`Result for "${exportName}" is not JSON-serializable.`);
  }
  return result;
};

const computeResponse = async (req) => {
  try {
    if (req.type === 'load') {
      const exports = await loadModule(req.modulePath);
      return { id: req.id, ok: true, exports };
    }
    if (req.type === 'invoke') {
      const value = await invokeExport(req.modulePath, req.exportName, req.args ?? []);
      return { id: req.id, ok: true, value };
    }
    if (req.type === 'loadLessPlugin') {
      const functions = await loadLessPlugin(req.modulePath, req.options ?? null);
      return { id: req.id, ok: true, functions };
    }
    if (req.type === 'invokeLessPluginFunction') {
      const outcome = await invokeLessPluginFunction(
        req.modulePath,
        req.functionName,
        req.args ?? [],
        req.options ?? null,
        req.facts ?? null
      );
      return outcome.need
        ? { id: req.id, ok: false, need: outcome.need, logs: outcome.logs }
        : { id: req.id, ok: true, value: outcome.value, logs: outcome.logs, important: outcome.important };
    }
    return { id: req.id, ok: false, error: `Unknown request type "${req.type}".` };
  } catch (err) {
    // A plugin throw is a real failure, so it carries its stack across the wire:
    // the host turns it into a diagnostic that names the function and the throw.
    return {
      id: req.id,
      ok: false,
      error: err?.message ?? String(err),
      errorName: err?.name ?? 'Error',
      stack: typeof err?.stack === 'string' ? err.stack : undefined
    };
  }
};

const handleRequest = async (req) => {
  if (!req || typeof req.id !== 'number' || typeof req.type !== 'string') {
    return;
  }
  send(await computeResponse(req));
};

async function main() {
  send({ type: 'ready' });

  let buffer = '';
  for await (const chunk of Deno.stdin.readable) {
    buffer += decoder.decode(chunk, { stream: true });
    let idx = buffer.indexOf('\n');
    while (idx >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      idx = buffer.indexOf('\n');
      if (!line) {
        continue;
      }
      let req;
      try {
        req = JSON.parse(line);
      } catch {
        continue;
      }
      await handleRequest(req);
    }
  }
}

void main();
