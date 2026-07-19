/**
 * Native Less-`@plugin` runtime (AST-native-plugins design, Lane 2 shim).
 *
 * This is the SMALLEST surface an existing Less-authored plugin codes against —
 * `functions.add`/`addMultiple`, `less.dimension`/`less.value`/…, and
 * `new tree.Anonymous(...)` return-value factories — re-homed as fresh, tree-free
 * code that speaks core's `ast/` value model (`ValueObj`) directly. It imports
 * ONLY the public `@jesscss/core/ast-render` value surface and
 * `@jesscss/plugin-node-modules` for resolution; it NEVER imports
 * `@jesscss/plugin-less-compat` (the retiring bridge) — the whole point of the
 * native subsystem.
 *
 * Boundary discipline (per design): plugin fn inputs/outputs are converted
 * to/from `ValueObj` at the CALL boundary ONLY — `fromLessArgs` is a shallow
 * per-arg leaf projection, `toValueObjReturn` a leaf reducer — not a whole-tree
 * bridge. `ast/` args arrive already materialized as typed `ValueObj` (the
 * serialize walk evaluated them), so there is no unevaluated node to `.eval()` —
 * the async record/replay dance the compat layer needed is simply gone.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import {
  makeDimension,
  makeColorRgb,
  makeQuoted,
  makeKeyword,
  makeList,
} from '@jesscss/core/ast-render';
import type { Fn, FnCtx, ValueObj, List } from '@jesscss/core/ast-render';
import { NodeModulesPlugin } from '@jesscss/plugin-node-modules';

/** A raw Less plugin function: takes evaluated Less-view args, returns a Less-ish value. */
type LessFn = (...args: unknown[]) => unknown;

/** The `functions` sink a plugin registers into (`functions.add`/`addMultiple`). */
interface FunctionSink {
  add(name: string, fn: LessFn): void;
  addMultiple(fns: Record<string, LessFn>): void;
  /** Less exposes `functions.functionRegistry` with the same add/addMultiple API. */
  functionRegistry: { add(name: string, fn: LessFn): void; addMultiple(fns: Record<string, LessFn>): void };
}

/** A config-injected Less plugin object with an `install(less, manager, functions)` hook. */
export interface InstallablePlugin {
  install?(less: unknown, manager: unknown, functions: FunctionSink['functionRegistry']): void;
  // registerPlugin lifecycle shape (subset — `install` is what registers functions).
  setOptions?(options: unknown): void;
  use?(): void;
}

/* ------------------------------------------------------- return-value reducer */

/** A drop sentinel: a statement-context `false`/no-op return emits nothing. */
const DROP: unique symbol = Symbol('plugin-drop');

/** Thrown to signal "leave the call verbatim" (unconvertible / undefined return). */
class VerbatimReturn extends Error {}

/**
 * Convert a plugin fn's return value into a native `ValueObj`, per the design's
 * return-value table. `undefined`/`null` → verbatim (throws — the evaluator's
 * scoped-fn catch re-emits the call bytes). A `false` return in a statement
 * context is a no-op → {@link DROP}. Everything else maps to a leaf `ValueObj`.
 */
function toValueObjReturn(ret: unknown, statementContext: boolean): ValueObj | typeof DROP {
  if (ret === null || ret === undefined) throw new VerbatimReturn();
  // A RAW number return is emitted VERBATIM as its `String(n)` form (Less wraps it
  // in an `Anonymous`, full precision — `pi-anon()` → `3.141592653589793`), NOT a
  // rounded `Dimension`. `less.dimension(n)` (the `{type:'Dimension'}` branch)
  // is the path that yields a canonicalizing dimension.
  if (typeof ret === 'number') return makeKeyword(String(ret));
  if (typeof ret === 'boolean') {
    if (statementContext) return DROP;
    return makeKeyword(String(ret));
  }
  if (typeof ret === 'string') return makeKeyword(ret);
  if (typeof ret === 'object') {
    const node = ret as Record<string, unknown>;
    const t = typeof node.type === 'string' ? node.type : undefined;
    if (t === 'Dimension') {
      return makeDimension(Number(node.value ?? 0), unitToString(node.unit));
    }
    if (t === 'Quoted') {
      const quote = node.quote === "'" || node.quote === '"' ? (node.quote as string) : '"';
      return makeQuoted(String(node.value ?? ''), quote, Boolean(node.escaped));
    }
    if (t === 'Color') {
      const rgb = normalizeRgb(node.rgb ?? node.value);
      return makeColorRgb(rgb, typeof node.alpha === 'number' ? node.alpha : 1, 0);
    }
    if (t === 'Keyword' || t === 'Anonymous') {
      return makeKeyword(nodeToText(node));
    }
    if (Array.isArray(ret)) {
      const items = (ret as unknown[]).map((v) => {
        const conv = toValueObjReturn(v, false);
        return conv === DROP ? makeKeyword('') : conv;
      });
      return makeList(items, ',');
    }
    if (typeof node.toCSS === 'function') {
      const css = (node.toCSS as () => unknown)();
      return makeKeyword(typeof css === 'string' ? css : String(css));
    }
  }
  if (Array.isArray(ret)) {
    const items = (ret as unknown[]).map((v) => {
      const conv = toValueObjReturn(v, false);
      return conv === DROP ? makeKeyword('') : conv;
    });
    return makeList(items, ',');
  }
  return makeKeyword(String(ret));
}

/** A Less node's text: `Anonymous.value` / `Keyword.value`, else `toCSS()`, else String. */
function nodeToText(node: Record<string, unknown>): string {
  if (typeof node.value === 'string') return node.value;
  if (typeof node.toCSS === 'function') {
    const css = (node.toCSS as () => unknown)();
    return typeof css === 'string' ? css : String(css);
  }
  return String(node.value ?? '');
}

/** A Less Unit → its display string (`unit.toString()` / `unit.toCSS()` / raw). */
function unitToString(unit: unknown): string {
  if (unit == null) return '';
  if (typeof unit === 'string') return unit;
  if (typeof unit === 'object') {
    const u = unit as Record<string, unknown>;
    if (typeof u.toString === 'function' && u.toString !== Object.prototype.toString) return String(u.toString());
    if (typeof u.toCSS === 'function') return String((u.toCSS as () => unknown)());
  }
  return '';
}

/** Coerce an RGB triple candidate to a `[r,g,b]` number tuple. */
function normalizeRgb(v: unknown): [number, number, number] {
  if (Array.isArray(v) && v.length >= 3) return [Number(v[0]) || 0, Number(v[1]) || 0, Number(v[2]) || 0];
  return [0, 0, 0];
}

/* -------------------------------------------------------- arg leaf projection */

/**
 * A shallow Less-view of one `ValueObj` arg — the field shape a Less fn reads
 * (`.value`, `.unit`, `.rgb`, `.type`). Leaf-only: `ast/` args are already
 * evaluated typed values, so this is a flat field copy, never a subtree walk.
 */
function toLessArg(v: ValueObj): unknown {
  switch (v.type) {
    case 'Dimension':
      return { type: 'Dimension', value: v.number, unit: v.unit, toCSS: () => v.bytes, valueOf: () => v.number };
    case 'Quoted':
      return { type: 'Quoted', value: v.value, quote: v.quote, escaped: v.escaped, toCSS: () => v.bytes };
    case 'Keyword':
      return { type: 'Keyword', value: v.text, toCSS: () => v.bytes };
    case 'Color':
      return { type: 'Color', rgb: v.rgb, alpha: v.alpha, value: v.rgb, toCSS: () => v.bytes };
    case 'List':
      return { type: 'Value', value: v.items.map(toLessArg), toCSS: () => v.bytes };
    case 'Bool':
      return { type: 'Keyword', value: String(v.value), valueOf: () => v.value, toCSS: () => v.bytes };
    default:
      return { type: 'Anonymous', value: v.bytes, toCSS: () => v.bytes };
  }
}

function fromLessArgs(list: List): unknown[] {
  return list.items.map(toLessArg);
}

/* ------------------------------------------------------------- fn wrapping */

/** Wrap a raw Less fn as a native `Fn`, converting args/return at the call boundary. */
function wrapLessFn(name: string, fn: LessFn): Fn {
  return {
    name: name.toLowerCase(),
    params: [],
    variadic: true,
    body: (list: List, _ctx: FnCtx): ValueObj => {
      const args = fromLessArgs(list);
      let ret: unknown;
      try {
        ret = fn(...args);
      } catch {
        throw new VerbatimReturn();
      }
      // Statement context is not modeled here (the value path dominates); a
      // dropped statement return degrades to an empty keyword (emits nothing
      // meaningful) rather than a special node — statement-context plugins
      // (`store`/`test-collapse`) are Lane-4/collection territory, out of scope.
      const conv = toValueObjReturn(ret, false);
      if (conv === DROP) return makeKeyword('');
      return conv;
    },
  };
}

export { VerbatimReturn };

/* --------------------------------------------------------- the `less` mock */

/**
 * Minimal `tree.*` factories the plugin builds return values with (leaf nodes).
 * Written as `function` EXPRESSIONS (not method shorthand) so a plugin can call
 * them with `new` — `new tree.Anonymous('global')` (method-shorthand functions
 * have no `[[Construct]]` and would throw). Each returns a plain object, so `new`
 * yields that object regardless.
 */
interface TreeConstructors {
  Anonymous(value: unknown): unknown;
  Quoted(quote: string, value: unknown, escaped?: boolean): unknown;
  Keyword(value: unknown): unknown;
  Dimension(value: number, unit?: string): unknown;
  Color(rgb: [number, number, number]): unknown;
  Value(value: unknown[]): unknown;
  DetachedRuleset(ruleset: unknown): unknown;
}

const treeConstructors: TreeConstructors = {
  Anonymous: function (value: unknown) {
    return { type: 'Anonymous', value, toCSS: () => String(value) };
  },
  Quoted: function (quote: string, value: unknown, escaped?: boolean) {
    return { type: 'Quoted', quote, value, escaped: !!escaped, toCSS: () => `${quote}${String(value)}${quote}` };
  },
  Keyword: function (value: unknown) {
    return { type: 'Keyword', value, toCSS: () => String(value) };
  },
  Dimension: function (value: number, unit?: string) {
    return { type: 'Dimension', value, unit: unit ?? '', toCSS: () => `${value}${unit ?? ''}` };
  },
  Color: function (rgb: [number, number, number]) {
    return { type: 'Color', rgb, value: rgb };
  },
  Value: function (value: unknown[]) {
    return { type: 'Value', value };
  },
  DetachedRuleset: function (ruleset: unknown) {
    return { type: 'DetachedRuleset', ruleset };
  },
};

/** Build the `less` object a plugin sees (the subset the fixtures exercise). */
function createLessMock(registry: FunctionSink['functionRegistry']) {
  return {
    tree: treeConstructors,
    functions: { functionRegistry: registry },
    dimension(value: number, unit?: string) {
      return treeConstructors.Dimension(value, unit);
    },
    value(values: unknown[]) {
      return values;
    },
    color(rgb: [number, number, number]) {
      return treeConstructors.Color(rgb);
    },
    quoted(quote: string, str: string) {
      return treeConstructors.Quoted(quote, str, false);
    },
    keyword(str: string) {
      return treeConstructors.Keyword(str);
    },
    atrule(name: string, value: unknown) {
      return { type: 'AtRule', name, value };
    },
  };
}

/* ----------------------------------------------------------- module loading */

/**
 * A per-render collection sink: `functions.add`/`addMultiple` register into
 * `fns`, wrapping each raw Less fn as a native `Fn`. `registerPlugin`/`install`
 * lifecycle drives the same sink.
 */
function createSink(): { sink: FunctionSink; fns: Fn[] } {
  const fns: Fn[] = [];
  const add = (name: string, fn: LessFn): void => {
    fns.push(wrapLessFn(name, fn));
  };
  const addMultiple = (map: Record<string, LessFn>): void => {
    for (const [name, fn] of Object.entries(map)) add(name, fn);
  };
  const registry = { add, addMultiple };
  const sink: FunctionSink = { add, addMultiple, functionRegistry: registry };
  return { sink, fns };
}

/** Run a config-injected `install`-style plugin, collecting its global fns. */
export function installPluginFns(plugins: readonly InstallablePlugin[]): Fn[] {
  const out: Fn[] = [];
  for (const plugin of plugins) {
    if (!plugin || typeof plugin.install !== 'function') continue;
    const { sink, fns } = createSink();
    const less = createLessMock(sink.functionRegistry);
    const manager = { addVisitor() {}, addPostProcessor() {}, addFileManager() {} };
    plugin.setOptions?.({});
    plugin.install(less, manager, sink.functionRegistry);
    out.push(...fns);
  }
  return out;
}

/**
 * Load a `@plugin` module source through a CJS sandbox, presenting the native
 * `functions`/`tree`/`less` surface, and collect the native `Fn`s it registers.
 * Re-homed verbatim from the compat loader's `new Function(...)` shape — it has
 * no tree dependency.
 */
function loadPluginSource(fullPath: string, source: string): Fn[] {
  const { sink, fns } = createSink();
  const less = createLessMock(sink.functionRegistry);
  const localModule: { exports: Record<string, unknown> } = { exports: {} };
  const registered: InstallablePlugin[] = [];
  const registerPlugin = (plugin: InstallablePlugin): void => {
    registered.push(plugin);
  };
  const loader = new Function(
    'module',
    'require',
    'registerPlugin',
    'functions',
    'tree',
    'less',
    'fileInfo',
    source,
  );
  loader(
    localModule,
    createRequire(fullPath),
    registerPlugin,
    sink,
    treeConstructors,
    less,
    { filename: fullPath },
  );
  // Drive `registerPlugin({ install, setOptions, use })` lifecycle (install
  // registers functions through the same sink).
  for (const plugin of registered) {
    plugin.setOptions?.({});
    plugin.install?.(less, { addVisitor() {}, addPostProcessor() {} }, sink.functionRegistry);
    plugin.use?.();
  }
  return fns;
}

/** Candidate-extension probe for a local-path specifier, relative to `baseDir`. */
function resolveLocal(specifier: string, baseDir: string): string | null {
  const base = path.resolve(baseDir, specifier);
  const candidates = [base, `${base}.js`, `${base}.cjs`, `${base}.mjs`];
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  return null;
}

/**
 * Resolve a `@plugin "specifier"` to an absolute file path. Less treats a bare
 * name as a LOCAL file first (needed for `plugin-transitive`), then falls back to
 * `node_modules` (trying the `less-plugin-` prefix convention).
 */
function resolvePluginPath(specifier: string, baseDir: string, nodeModules: NodeModulesPlugin): string | null {
  const local = resolveLocal(specifier, baseDir);
  if (local) return local;
  for (const name of [specifier, `less-plugin-${specifier}`]) {
    const resolved = nodeModules.resolvePackage(name);
    if (resolved) return resolved;
  }
  return null;
}

/* --------------------------------------------------------- the plugin host */

export interface CreatePluginHostOptions {
  /** Base directory `@plugin` specifiers resolve against (the entry file's dir). */
  baseDir: string;
  /** Config-injected `install`-style Less plugins → root-frame global fns. */
  configPlugins?: readonly InstallablePlugin[];
}

/**
 * Build the {@link import('@jesscss/core/ast-render').PluginHost} core consults:
 * `globalFns` from config-injected `install` plugins, and `loadPlugin` resolving +
 * loading a `@plugin "specifier"` module into native `Fn`s. Loads are memoized by
 * specifier (a re-registered scope re-uses the same fns — cheap, and options are
 * not modeled).
 */
export function createPluginHost(options: CreatePluginHostOptions): {
  globalFns?: readonly Fn[];
  loadPlugin?(specifier: string): readonly Fn[];
} {
  const baseDir = options.baseDir;
  const nodeModules = new NodeModulesPlugin();
  const cache = new Map<string, readonly Fn[]>();
  const globalFns = options.configPlugins?.length ? installPluginFns(options.configPlugins) : undefined;
  return {
    globalFns,
    loadPlugin(specifier: string): readonly Fn[] {
      const cached = cache.get(specifier);
      if (cached) return cached;
      let fns: readonly Fn[] = [];
      const fullPath = resolvePluginPath(specifier, baseDir, nodeModules);
      if (fullPath) {
        try {
          const source = fs.readFileSync(fullPath, 'utf8');
          fns = loadPluginSource(fullPath, source);
        } catch {
          fns = [];
        }
      }
      cache.set(specifier, fns);
      return fns;
    },
  };
}
