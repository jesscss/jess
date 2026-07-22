import {
  type Plugin,
  AbstractPlugin,
  type Context,
  type UrlTransformRequest,
  extractRelevantLines,
  type ISafeParseResult,
  type SafeParseOptions,
  type ErrorDiagnostic
} from '@jesscss/core';
import { defineFunction, makeDimension, makeKeyword, makeQuoted, type Fn, type PluginHost, type ValueObj } from '@jesscss/core/value';
import type { EqualityMode, MathMode, UnitMode, LessOptions } from 'styles-config';
import path from 'node:path';
import { createRequire } from 'node:module';
import { expandLessImportCandidates } from '@jesscss/style-resolver';
import { parse as parseLess } from '@jesscss/less-parser';

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

function toNativeLessValue(value: ValueObj): unknown {
  switch (value.type) {
    case 'Dimension': return { type: 'Dimension', value: value.number, unit: value.unit, valueOf: () => value.number };
    case 'Quoted': return { type: 'Quoted', value: value.value, quote: value.quote, escaped: value.escaped, valueOf: () => value.bytes };
    case 'Color': return { type: 'Color', rgb: value.rgb, alpha: value.alpha, valueOf: () => value.bytes };
    case 'List': return { type: 'Expression', value: value.value.map(toNativeLessValue), valueOf: () => value.bytes };
    default: return { type: 'Anonymous', value: value.bytes, valueOf: () => value.bytes };
  }
}

function fromNativeLessValue(value: unknown): ValueObj {
  if (typeof value === 'number') {
    return makeDimension(value);
  }
  if (typeof value === 'string') {
    return makeKeyword(value);
  }
  if (value && typeof value === 'object') {
    const candidate = value as { type?: unknown; value?: unknown; unit?: unknown; quote?: unknown; escaped?: unknown; valueOf?: () => unknown };
    if ((candidate.type === 'Dimension' || candidate.type === 'Num') && typeof candidate.value === 'number') {
      return makeDimension(candidate.value, typeof candidate.unit === 'string' ? candidate.unit : '');
    }
    if (candidate.type === 'Quoted' && typeof candidate.value === 'string') {
      return makeQuoted(candidate.value, candidate.quote === '\'' ? '\'' : '"', candidate.escaped === true);
    }
    if (typeof candidate.value === 'string') {
      return makeKeyword(candidate.value);
    }
    if (typeof candidate.valueOf === 'function') {
      return makeKeyword(String(candidate.valueOf()));
    }
  }
  return makeKeyword(value == null ? '' : String(value));
}

function nativeLessFn(name: string, fn: NativeLessFunction): Fn {
  return defineFunction(name.toLowerCase(), {
    variadic: true,
    params: [],
    body: (list) => {
      const result = fn(...list.value.map(toNativeLessValue));
      return result !== null && typeof result === 'object' && 'then' in result && typeof result.then === 'function'
        ? Promise.resolve(result).then(fromNativeLessValue)
        : fromNativeLessValue(result);
    }
  });
}

type LoadedPluginModule = {
  readonly functions?: Record<string, NativeLessFunction>;
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

function parseErrorLocation(source: string, error: unknown): { line: number; column: number } {
  const offset = typeof error === 'object' && error !== null && 'offset' in error && typeof error.offset === 'number'
    ? Math.max(0, Math.min(source.length, error.offset))
    : 0;
  const before = source.slice(0, offset);
  const line = before.split('\n').length;
  const column = offset - (before.lastIndexOf('\n') + 1) + 1;
  return { line, column };
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
    let host = this.pluginHosts.get(context);
    if (!host) {
      const fns: Fn[] = [];
      const registry: NativeLessFunctionRegistry = {
        add: (name, fn) => {
          fns.push(nativeLessFn(name, fn));
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
          return Object.entries(functions).map(([name, fn]) => nativeLessFn(name, fn));
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
      const message = error instanceof Error ? error.message : String(error);
      const location = parseErrorLocation(source, error);
      return {
        errors: [{
          code: 'parse/syntax-error',
          phase: 'parse',
          message,
          reason: message,
          fix: 'Check the Less source against the supported grammar.',
          filePath,
          line: location.line,
          column: location.column,
          lines: extractRelevantLines(source, location.line)
        } satisfies ErrorDiagnostic],
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
