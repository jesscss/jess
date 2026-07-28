import {
  type Plugin,
  AbstractPlugin,
  Context,
  type UrlTransformRequest,
  ERR,
  type ISafeParseResult,
  type SafeParseOptions,
  buildEvaluator
} from '@jesscss/core';
import { type PluginHost } from '@jesscss/core/value';
import { makeLessRegistry } from '@jesscss/fns/less/registry';
import { LessApiBridge, type NativeLessPlugin } from '@jesscss/plugin-less-compat';
import type { EqualityMode, MathMode, UnitMode, LessOptions } from 'styles-config';
import path from 'node:path';
import { createRequire } from 'node:module';
import { expandLessImportCandidates } from '@jesscss/style-resolver';
import { safeParse as safeParseLess } from '@jesscss/less-parser';

export type LessPluginOptions = LessOptions;

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
  processImports: true,
  collapseNesting: false
} as const;

const lessValueEvaluator = buildEvaluator(makeLessRegistry());

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
  processImports: boolean;
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
    this.processImports = opts.processImports ?? lessPluginDefaults.processImports;
    this.collapseNesting = opts.collapseNesting ?? lessPluginDefaults.collapseNesting;
  }

  transformUrl({ value, quoted, fromFilePath, entryFilePath }: UrlTransformRequest): string {
    let transformed: string;
    if (isUrlRelative(value)) {
      const rewriteUrls = this.opts.rewriteUrls;
      const local = value.startsWith('.');

      /*
       * `rootpath` applies to every relative URL by default, but the explicit
       * Less `local` mode narrows that to authored ./ and ../ paths.
       */
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
    if (context.documentContext?.plugin !== this) {
      return;
    }

    /*
     * The Less adapter owns the language defaults, while Context owns the
     * session-level option store consumed by the AST evaluator.  A caller's
     * explicit compile option (and a matching file/language option already
     * folded into context.opts) always wins; fill only unset fields here.
     */
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
    if (context.opts.processImports === undefined) {
      context.setOption('processImports', this.processImports);
    }
    context.registerValueEvaluator(lessValueEvaluator);

    let host = this.pluginHosts.get(context);
    if (!host) {
      const configured = (this.opts as LessPluginOptions & { plugins?: NativeLessPlugin[] }).plugins ?? [];
      const bridge = new LessApiBridge(configured);
      host = bridge.createPluginHost({
        loadPluginModule: async ({ specifier, options }) => {
          /*
           * `@plugin` loads and executes a script module. When script modules
           * are disabled the load must REFUSE here: the ast/ evaluator reaches
           * `loadPlugin` directly (prepareBodyPlugins), so the import-path
           * check in Context is not on this route.
           */
          if (context.opts.disableScriptModules || context.opts.disablePluginRule) {
            throw ERR.pluginLoadFailed({
              meta: {
                specifier,
                reason: 'script module execution is disabled by disableScriptModules'
              },
              reason: `"@plugin \\"${specifier}\\"" loads and executes a script module, which this compile disabled.`,
              fix: 'Remove the @plugin statement, or stop setting disableScriptModules for this compile.'
            });
          }
          const loaded = await context.getPluginModule(specifier, options);
          return loaded.module;
        }
      });
      this.pluginHosts.set(context, host);
    }
    const existingHost = context.pluginHost;
    const globalFns = [
      ...(existingHost?.globalFns ?? []),
      ...(host.globalFns ?? [])
    ];
    context.pluginHost = {
      ...existingHost,
      ...host,
      ...(globalFns.length === 0 ? {} : { globalFns }),
      loadPlugin: host.loadPlugin || existingHost?.loadPlugin
        ? request => Promise.all([
          existingHost?.loadPlugin?.(request) ?? [],
          host.loadPlugin?.(request) ?? []
        ]).then(([existingFns, hostFns]) => [
          ...existingFns,
          ...hostFns
        ])
        : undefined,
      invokeRawFunction: (fn, args, ctx) =>
        host.invokeRawFunction?.(fn, args, ctx) ?? existingHost?.invokeRawFunction?.(fn, args, ctx)
    };
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
    return safeParseLess(filePath, source);
  }
}

export type { LessOptions } from 'styles-config';
const lessPlugin = ((opts?: LessPluginOptions) => {
  return new LessPlugin(opts);
}) satisfies Plugin;

export default lessPlugin;
