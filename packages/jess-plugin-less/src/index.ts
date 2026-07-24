import {
  type Plugin,
  AbstractPlugin,
  type Context,
  type UrlTransformRequest,
  parserDiagnostic,
  type ISafeParseResult,
  type SafeParseOptions
} from '@jesscss/core';
import {
  defineFunction,
  emitValue,
  groupItems,
  makeDimension,
  makeKeyword,
  makeList,
  makeQuoted,
  sniffLiteral,
  type Fn,
  type PluginCallCtx,
  type PluginHost,
  type PluginRawArgument,
  type ValueGroup,
  type ValueObj
} from '@jesscss/core/value';

import type { EqualityMode, MathMode, UnitMode, LessOptions } from 'styles-config';
import path from 'node:path';
import { createRequire } from 'node:module';
import { expandLessImportCandidates } from '@jesscss/style-resolver';
import { parse as parseLess } from '@jesscss/less-parser';

/**
 * A `@plugin` function bound to its live call-site capabilities. Structurally
 * identical to `@jesscss/plugin-js`'s export; declared here so the Less adapter
 * does not take a hard dependency on the sandbox package.
 */
type ContextualPluginFunction = (
  args: readonly unknown[],
  capabilities: {
    lookupVariable?(name: string): { value: unknown; important?: boolean } | null;
    callFunction?(name: string, args: unknown[]): unknown;
    currentFileInfo?: { filename: string; entryPath: string };
    log?(record: { level: string; message: string }): void;
    markImportant?(): void;
  }
) => unknown | Promise<unknown>;

export type LessPluginOptions = LessOptions;

type NativeLessFunction = (...args: unknown[]) => unknown;
type NativeLessPlugin = { install?: (less: NativeLessApi, manager: undefined, functions: NativeLessFunctionRegistry) => void };
type NativeLessFunctionRegistry = {
  add(name: string, fn: NativeLessFunction): void;
  addMultiple(functions: Record<string, NativeLessFunction>): void;
};
type NativeLessApi = {
  functions: { functionRegistry: NativeLessFunctionRegistry };
  /** Return-value constructors exposed by Less's public plugin API. These are
   * plain structural values; core owns their conversion back to typed Values. */
  tree: {
    Dimension: new (value: number, unit?: string) => { type: 'Dimension'; value: number; unit: string };
    Quoted: new (quote: string, value: string, escaped?: boolean) => { type: 'Quoted'; quote: string; value: string; escaped: boolean };
  };
};

type NativeNil = { readonly type: 'Nil'; readonly value: ''; eval(): NativeNil };

const nativeNil = (): NativeNil => {
  const nil: NativeNil = { type: 'Nil', value: '', eval: () => nil };
  return nil;
};

function isRawSequence(value: PluginRawArgument | ValueGroup): value is readonly ValueGroup[] {
  return Array.isArray(value);
}

function isPluginDetached(value: PluginRawArgument | ValueGroup): value is Extract<PluginRawArgument, { type: 'DetachedRuleset' }> {
  return !isRawSequence(value) && value.type === 'DetachedRuleset';
}

function toNativeLessValue(value: PluginRawArgument | ValueGroup): unknown {
  if (isRawSequence(value)) {
    return { type: 'Expression', value: value.map(toNativeLessValue), valueOf: () => emitValue(value) };
  }
  if (isPluginDetached(value)) {
    const name = nativeNil();
    const args = nativeNil();
    const rules = value.rules.map(rule => ({
      type: 'Declaration' as const,
      name: rule.name,
      value: toNativeLessValue(rule.value),
      eval() {
        return this;
      }
    }));
    const mixin = {
      type: 'Mixin' as const,
      name,
      args,
      ruleset: { rules },
      eval() {
        return mixin;
      }
    };
    return mixin;
  }
  return toNativeValue(value);
}

function toNativeValue(value: ValueObj): unknown {
  switch (value.type) {
    case 'Dimension': return { type: 'Dimension', value: value.number, unit: value.unit, valueOf: () => value.number };
    case 'Quoted': return { type: 'Quoted', value: value.value, quote: value.quote, escaped: value.escaped, valueOf: () => value.bytes };
    case 'Color': return { type: 'Color', rgb: value.rgb, alpha: value.alpha, valueOf: () => value.bytes };
    case 'List':
      return value.sep === ',' || value.sep === '/'
        ? { type: 'Value', value: value.value.map(toNativeLessValue), separator: value.sep, valueOf: () => value.bytes }
        : { type: 'Anonymous', value: value.bytes, valueOf: () => value.bytes };
    default: return { type: 'Anonymous', value: value.bytes, valueOf: () => value.bytes };
  }
}

function isNativeValue(value: unknown): value is ValueObj {
  return value !== null
    && typeof value === 'object'
    && 'bytes' in value
    && typeof value.bytes === 'string';
}

function fromNativeLessValue(value: unknown): ValueGroup {
  if (isNativeValue(value)) {
    return value;
  }
  if (typeof value === 'number') {
    return makeDimension(value);
  }
  if (typeof value === 'string') {
    return makeKeyword(value);
  }
  if (value && typeof value === 'object') {
    const candidate = value as { type?: unknown; value?: unknown; unit?: unknown; quote?: unknown; escaped?: unknown; separator?: unknown; valueOf?: () => unknown };
    if ((candidate.type === 'Dimension' || candidate.type === 'Num') && typeof candidate.value === 'number') {
      return makeDimension(candidate.value, typeof candidate.unit === 'string' ? candidate.unit : '');
    }
    if (candidate.type === 'Quoted' && typeof candidate.value === 'string') {
      return makeQuoted(candidate.value, candidate.quote === '\'' ? '\'' : '"', candidate.escaped === true);
    }
    if (candidate.type === 'Expression' && Array.isArray(candidate.value)) {
      return candidate.value.map(fromNativeLessValue);
    }
    if (candidate.type === 'Value' && Array.isArray(candidate.value)) {
      const separator = candidate.separator === '/' ? '/' : ',';
      return makeList(candidate.value.map(item => fromNativeLessValue(item)), separator);
    }
    if (typeof candidate.value === 'string') {
      // A Less plugin's `Anonymous`/`Keyword` result is BYTES. Sniffing them back
      // into a typed literal is what lets `darken(theme-color(primary), 15%)`
      // see a colour rather than an opaque keyword — the same materialization
      // the engine performs on any other computed byte string.
      return sniffLiteral(candidate.value);
    }
    if (typeof candidate.valueOf === 'function') {
      return sniffLiteral(String(candidate.valueOf()));
    }
  }
  return makeKeyword(value == null ? '' : String(value));
}

function invokeNativeLessFunction(fn: NativeLessFunction, args: readonly PluginRawArgument[]): ValueGroup | Promise<ValueGroup> {
  const result = fn(...args.map(toNativeLessValue));
  return result !== null && typeof result === 'object' && 'then' in result && typeof result.then === 'function'
    ? Promise.resolve(result).then(fromNativeLessValue)
    : fromNativeLessValue(result);
}

/**
 * Run one `@plugin`-loaded function. Unlike a config-injected `install` plugin,
 * a `@plugin` script's body reads the live evaluation scope, so its call-site
 * capabilities are forwarded verbatim to the sandbox bridge.
 */
function invokeContextualPluginFunction(
  fn: ContextualPluginFunction,
  args: readonly PluginRawArgument[],
  ctx: PluginCallCtx
): ValueGroup | Promise<ValueGroup> {
  const result = fn(args.map(toNativeLessValue), {
    lookupVariable: (name) => {
      const hit = ctx.lookupVariable(name);
      return hit === null ? null : { value: toNativeLessValue(hit.value), important: hit.important };
    },
    callFunction: (name, callArgs) => {
      const answer = ctx.callFunction(name, callArgs.map(fromNativeLessValue));
      return answer === undefined ? undefined : toNativeLessValue(answer);
    },
    currentFileInfo: ctx.currentFileInfo,
    log: record => ctx.log(record),
    markImportant: () => ctx.markImportant()
  });
  // A synchronous bridge keeps the result synchronous, which is what lets a
  // plugin value be read from a guard condition.
  return result !== null && typeof result === 'object' && 'then' in result && typeof result.then === 'function'
    ? Promise.resolve(result).then(fromNativeLessValue)
    : fromNativeLessValue(result);
}

function nativeLessFn(name: string, fn: NativeLessFunction): Fn {
  return defineFunction(name.toLowerCase(), {
    variadic: true,
    params: [],
    body: value => invokeNativeLessFunction(fn, groupItems(value))
  });
}

/**
 * A `@plugin` function's value-domain façade. It is never invoked through this
 * body — `invokeRawFunction` always claims it first, because the body has no way
 * to supply the live-frame capabilities the plugin needs. Reaching here means
 * the host seam was bypassed, which is a wiring bug, not a plugin fault.
 */
function contextualLessFn(name: string): Fn {
  return defineFunction(name.toLowerCase(), {
    variadic: true,
    params: [],
    body: () => {
      throw new Error(
        `Less @plugin function "${name}" needs the plugin invocation seam; it cannot run through plain function dispatch.`
      );
    }
  });
}

type LoadedPluginModule = {
  readonly functions?: Record<string, ContextualPluginFunction>;
};

function isLoadedPluginModule(value: unknown): value is LoadedPluginModule {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  if (!('functions' in value) || value.functions === undefined) {
    return true;
  }
  return typeof value.functions === 'object'
    && value.functions !== null
    && Object.values(value.functions).every(fn => typeof fn === 'function');
}

/**
 * The Less plugin's default option values — the single source of truth for the
 * v5 defaults. The `LessPlugin` constructor fills any unset option from here,
 * and the `lessc` CLI imports the same object so its defaults can never drift
 * from the engine's. Note `collapseNesting: false` — v5 preserves nesting by
 * default (Less 4.x flattened; that is now an explicit opt-in).
 */
export const lessPluginDefaults = {
  mathMode: 'parens-division' as MathMode,
  unitMode: 'preserve' as UnitMode,
  equalityMode: 'less' as EqualityMode,
  leakyScope: true,
  bubbleRootAtRules: true,
  collapseNesting: false
} as const;

/** Match Less's URL normalization without treating URL text as an import path. */
function normalizeUrlPath(url: string): string {
  const segments = url.split('/');
  const normalized: string[] = [];
  for (const segment of segments) {
    if (segment === '.') {
      continue;
    }
    if (segment === '..') {
      if (normalized.length === 0 || normalized[normalized.length - 1] === '..') {
        normalized.push(segment);
      } else {
        normalized.pop();
      }
      continue;
    }
    normalized.push(segment);
  }
  return normalized.join('/');
}

function isUrlRelative(url: string): boolean {
  if (url.startsWith('/') || url.startsWith('#')) {
    return false;
  }
  const colon = url.indexOf(':');
  if (colon < 0) {
    return true;
  }
  for (let index = 0; index < colon; index++) {
    const code = url.charCodeAt(index);
    const isLetter = (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
    if (!isLetter && url[index] !== '-') {
      return true;
    }
  }
  return false;
}

function rewriteUrlPath(url: string, rootpath: string): string {
  const rewritten = normalizeUrlPath(rootpath + url);
  return url.startsWith('.') && isUrlRelative(rootpath) && !rewritten.startsWith('.')
    ? `./${rewritten}`
    : rewritten;
}

function escapeUnquotedUrlPath(pathValue: string): string {
  let escaped = '';
  for (const char of pathValue) {
    escaped += char === '(' || char === ')' || char === '\'' || char === '"' || ' \t\n\r\f'.includes(char)
      ? `\\${char}`
      : char;
  }
  return escaped;
}

function jsDelivrPackageSpecifier(candidate: string): string | null {
  const absolute = candidate.match(/^https?:\/\/cdn\.jsdelivr\.net\/npm\/([^?#]+)(?:[?#].*)?$/i);
  if (absolute?.[1]) {
    return absolute[1];
  }
  const relative = candidate.match(/^\/\/cdn\.jsdelivr\.net\/npm\/([^?#]+)(?:[?#].*)?$/i);
  return relative?.[1] ?? null;
}

export class LessPlugin extends AbstractPlugin {
  name = 'less';
  supportedExtensions = ['.less'];
  mathMode: MathMode;
  unitMode: UnitMode;
  equalityMode: EqualityMode;
  leakyScope: boolean;
  bubbleRootAtRules: boolean;
  collapseNesting: boolean;
  private readonly pluginHosts = new WeakMap<Context, PluginHost>();

  constructor(public opts: LessPluginOptions = {}) {
    super();

    // Handle deprecated math option -> mathMode conversion
    let mathMode: MathMode;
    if (opts.mathMode !== undefined) {
      mathMode = opts.mathMode;
    } else if (opts.math !== undefined) {
      // Convert deprecated math option to mathMode
      if (opts.math === 0 || opts.math === 'always') {
        mathMode = 'always';
      } else if (opts.math === 1 || opts.math === 'parens-division') {
        mathMode = 'parens-division';
      } else if (opts.math === 2 || opts.math === 'parens' || opts.math === 'strict') {
        mathMode = 'parens';
      } else {
        // 3 or 'strict-legacy' -> 'parens' (deprecated, use 'strict' instead)
        mathMode = 'parens';
      }
    } else {
      mathMode = lessPluginDefaults.mathMode;
    }
    this.mathMode = mathMode;

    // Handle deprecated strictUnits option -> unitMode conversion
    let unitMode: UnitMode;
    if (opts.unitMode !== undefined) {
      unitMode = opts.unitMode;
    } else if (opts.strictUnits === true) {
      unitMode = 'strict';
    } else {
      unitMode = lessPluginDefaults.unitMode;
    }
    this.unitMode = unitMode;
    this.equalityMode = opts.equalityMode ?? lessPluginDefaults.equalityMode;
    this.leakyScope = opts.leakyScope ?? lessPluginDefaults.leakyScope;
    this.bubbleRootAtRules = opts.bubbleRootAtRules ?? lessPluginDefaults.bubbleRootAtRules;
    this.collapseNesting = opts.collapseNesting ?? lessPluginDefaults.collapseNesting;
  }

  transformUrl({ value, quoted, fromFilePath, entryFilePath }: UrlTransformRequest): string {
    let transformed: string;
    if (isUrlRelative(value)) {
      const rewriteUrls = this.opts.rewriteUrls;
      const local = value.startsWith('.');
      // `rootpath` applies to every relative URL by default, but the explicit
      // Less `local` mode narrows that to authored ./ and ../ paths.
      if (rewriteUrls !== 'local' || local) {
        const rebasesImportedUrl = rewriteUrls === true || rewriteUrls === 'all' || (rewriteUrls === 'local' && local);
        let rootpath = this.opts.rootpath ?? '';
        if (!quoted) {
          rootpath = escapeUnquotedUrlPath(rootpath);
        }
        if (rebasesImportedUrl && fromFilePath && entryFilePath) {
          const relativeDirectory = path.relative(path.dirname(entryFilePath), path.dirname(fromFilePath));
          if (relativeDirectory) {
            rootpath += `${relativeDirectory.split(path.sep).join('/')}/`;
          }
        }
        transformed = rewriteUrlPath(value, rootpath);
      } else {
        transformed = normalizeUrlPath(value);
      }
    } else {
      transformed = normalizeUrlPath(value);
    }
    if (this.opts.urlArgs && !value.trimStart().toLowerCase().startsWith('data:')) {
      const args = `${transformed.includes('?') ? '&' : '?'}${this.opts.urlArgs}`;
      const fragment = transformed.indexOf('#');
      transformed = fragment < 0
        ? transformed + args
        : transformed.slice(0, fragment) + args + transformed.slice(fragment);
    }
    return transformed;
  }

  expandImport(importPath: string, currentDir: string) {
    void currentDir;
    // Keep import expansion in sync with the language service.
    return expandLessImportCandidates(importPath);
  }

  setContext(context: Context): void {
    // The Less adapter owns the language defaults, while Context owns the
    // session-level option store consumed by the AST evaluator.  A caller's
    // explicit compile option (and a matching file/language option already
    // folded into context.opts) always wins; fill only unset fields here.
    if (context.opts.mathMode === undefined) {
      context.setOption('mathMode', this.mathMode);
    }
    if (context.opts.unitMode === undefined) {
      context.setOption('unitMode', this.unitMode);
    }
    if (context.opts.equalityMode === undefined) {
      context.setOption('equalityMode', this.equalityMode);
    }
    if (context.opts.leakyScope === undefined) {
      context.setOption('leakyScope', this.leakyScope);
    }
    if (context.opts.bubbleRootAtRules === undefined) {
      context.setOption('bubbleRootAtRules', this.bubbleRootAtRules);
    }

    let host = this.pluginHosts.get(context);
    if (!host) {
      const fns: Fn[] = [];
      const nativeFns = new WeakMap<Fn, NativeLessFunction>();
      const contextualFns = new WeakMap<Fn, ContextualPluginFunction>();
      const addNativeFn = (name: string, fn: NativeLessFunction): Fn => {
        const adapted = nativeLessFn(name, fn);
        nativeFns.set(adapted, fn);
        fns.push(adapted);
        return adapted;
      };
      const addContextualFn = (name: string, fn: ContextualPluginFunction): Fn => {
        const adapted = contextualLessFn(name);
        contextualFns.set(adapted, fn);
        fns.push(adapted);
        return adapted;
      };
      const registry: NativeLessFunctionRegistry = {
        add: (name, fn) => {
          addNativeFn(name, fn);
        },
        addMultiple: (functions) => {
          for (const [name, fn] of Object.entries(functions)) {
            registry.add(name, fn);
          }
        }
      };
      const less: NativeLessApi = {
        functions: { functionRegistry: registry },
        tree: {
          Dimension: class {
            type = 'Dimension' as const;
            constructor(readonly value: number, readonly unit = '') {}
          },
          Quoted: class {
            type = 'Quoted' as const;
            constructor(readonly quote: string, readonly value: string, readonly escaped = false) {}
          }
        }
      };
      const configured = (this.opts as LessPluginOptions & { plugins?: NativeLessPlugin[] }).plugins ?? [];
      for (const plugin of configured) {
        plugin.install?.(less, undefined, registry);
      }
      host = {
        ...(fns.length === 0 ? {} : { globalFns: fns }),
        loadPlugin: async ({ specifier, options }) => {
          const loaded = await context.getPluginModule(specifier, options);
          const functions = isLoadedPluginModule(loaded.module) ? loaded.module.functions : undefined;
          if (!functions) {
            return [];
          }
          return Object.entries(functions).map(([name, fn]) => addContextualFn(name, fn));
        },
        invokeRawFunction: (fn, args, ctx) => {
          const contextual = contextualFns.get(fn);
          if (contextual) {
            return invokeContextualPluginFunction(contextual, args, ctx);
          }
          const native = nativeFns.get(fn);
          return native ? invokeNativeLessFunction(native, args) : undefined;
        }
      };
      this.pluginHosts.set(context, host);
    }
    context.pluginHost = host;
  }

  override resolve(filePath: string | string[], currentDir: string, searchPaths: string[]) {
    const paths = Array.isArray(filePath) ? filePath : [filePath];
    const mapped = paths.map((candidate) => {
      if (candidate.startsWith('@less/test-import-module/')) {
        const after = candidate.slice('@less/test-import-module/'.length);
        const marker = `${path.sep}packages${path.sep}test-data${path.sep}`;
        const idx = currentDir.indexOf(marker);
        if (idx !== -1) {
          const packagesRoot = currentDir.slice(0, idx + `${path.sep}packages`.length);
          return path.join(packagesRoot, 'test-import-module', after);
        }
      }
      return jsDelivrPackageSpecifier(candidate) ?? candidate;
    });

    const resolved = super.resolve(mapped, currentDir, searchPaths);
    const out = [...resolved];
    const bases = [currentDir, ...searchPaths, process.cwd()];
    const looksBareSpecifier = (p: string) =>
      !path.isAbsolute(p)
      && !p.startsWith('./')
      && !p.startsWith('../')
      && !p.startsWith('/')
      && !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(p);

    for (const candidate of mapped) {
      if (!looksBareSpecifier(candidate)) {
        continue;
      }
      for (const base of bases) {
        const baseDir = path.isAbsolute(base) ? base : path.resolve(currentDir, base);
        try {
          const req = createRequire(path.join(baseDir, '__jess_resolve__.js'));
          const resolvedModule = req.resolve(candidate);
          if (!out.includes(resolvedModule)) {
            out.push(resolvedModule);
          }
          break;
        } catch {
          try {
            const req = createRequire(path.join(baseDir, '__jess_resolve__.js'));
            const resolvedModuleLess = req.resolve(`${candidate}.less`);
            if (!out.includes(resolvedModuleLess)) {
              out.push(resolvedModuleLess);
            }
            break;
          } catch {
            // keep trying other base dirs
          }
        }
      }
    }
    return out;
  }

  canResolveImport(specifier: string): boolean {
    return jsDelivrPackageSpecifier(specifier) !== null;
  }

  safeParse(filePath: string, source: string, parseOptions?: SafeParseOptions): ISafeParseResult {
    void parseOptions;
    try {
      return { document: parseLess(source), errors: [], warnings: [] };
    } catch (error) {
      return {
        errors: [parserDiagnostic({ dialect: 'Less', error, filePath, source })],
        warnings: []
      };
    }
  }
}

export type { LessOptions } from 'styles-config';
const lessPlugin = ((opts?: LessPluginOptions) => {
  return new LessPlugin(opts);
}) satisfies Plugin;

export default lessPlugin;
