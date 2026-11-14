import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Compiler, type ConfigOptions } from 'jess';
import type { Plugin, PluginContext, RollupLog } from 'rollup';

type RenderResult = Awaited<ReturnType<Compiler['renderToResult']>>;
type ExportRuntimeData = NonNullable<RenderResult['runtime']>;
type ExportRecipe = ExportRuntimeData['derived'][string];
type ExportColor = Extract<Extract<ExportRecipe, { args: unknown }>['args'][number], { color: string }>;
type Diagnostic = RenderResult['errors'][number] | RenderResult['warnings'][number];

export type JessRollupPluginOptions = {
  /**
   * Options passed into the Jess compiler for each file.
   * (Use this to set output options, plugins, etc.)
   */
  config?: Partial<ConfigOptions>;

  /**
   * Emit a CSS asset alongside the JS module (Rollup). Under Vite the module
   * imports its CSS instead, so Vite injects and bundles it.
   * Default: true
   */
  emitCss?: boolean;

  /**
   * Emit file name for the CSS asset. Defaults to `<basename>.css`.
   */
  cssFileName?: (id: string) => string;

  /**
   * Accept a colour name (`red`) from `vars()` for an export that a computed
   * value reads as a colour. Without it the name table ships only when the
   * stylesheet itself writes a name the runtime reads (such an export's own
   * value, or an argument of a computed call); otherwise `vars()`
   * takes a hex colour there and throws a `TypeError` on a name
   * (docs/architecture/core/spec/R8-browser-runtime.md, colour names).
   * Default: false
   */
  colorNames?: boolean;
};

/** The part of Vite's hot-update context this plugin reads. */
type HotUpdate<M> = {
  readonly file: string;
  readonly modules: readonly M[];
  readonly server: { readonly moduleGraph: { getModuleById(id: string): M | undefined } };
};

const LANGUAGES: ReadonlyMap<string, string> = new Map([['.jess', 'jess'], ['.less', 'less']]);

/** A stylesheet's JS module (`<prefix><file>.js`): an id no CSS plugin claims. */
const MODULE = '\0jess:';

/** A CSS Modules stylesheet. */
const MODULES = /\.module\.[^./]+$/;

/** What a stylesheet's import asks for when it wants the CSS as a string: Vite's CSS plugin reads it off the CSS id. */
const INLINE = '?inline';

/**
 * A stylesheet's CSS under Vite: a path beside the stylesheet, so `url()`,
 * `@import` and `composes` in it resolve from the stylesheet's directory, and
 * the `.module.css` ending sends a CSS Modules stylesheet through Vite's CSS
 * Modules. It keeps the stylesheet's whole name, so `a.module.less` and
 * `a.module.jess` stay two stylesheets. No such file exists; {@link load} serves it.
 */
const cssId = (file: string): string => `${file}${MODULES.test(file) ? '.module.css' : '.css'}`;

/** Where the runtime's own imports (`@jesscss/patch-css`, `@jesscss/fns/…`) resolve from: this package, which depends on them. */
const ANCHOR = fileURLToPath(import.meta.url);

/**
 * `rollup-plugin-jess`: compiles `.jess` and `.less` imports with the `jess`
 * compiler. The module's default export is the CSS; the CSS is also emitted as
 * an asset (Rollup) or imported (Vite). A stylesheet that exposes variables
 * (`@expose brand;`) also exports `vars(values)` and `set(values,
 * target?)`: over `@jesscss/patch-css` when nothing is computed from an export,
 * else `vars` from `@jesscss/fns/runtime`, which recomputes what depends on them
 * (docs/architecture/core/spec/R8-browser-runtime.md).
 */
export default function jessRollupPlugin(options: JessRollupPluginOptions = {}): Plugin & { enforce: 'pre'; configResolved(config: { readonly root: string }): void; handleHotUpdate<M>(context: HotUpdate<M>): M[] } {
  const emitCss = options.emitCss ?? true;
  const cssFileName = options.cssFileName ?? ((id: string) => `${path.basename(id, path.extname(id))}.css`);
  const sheets = new Map<string, string>();

  /** Under Vite, the project root its dev server's URLs start from. */
  let viteRoot: string | undefined;

  const render = makeRender(options.config);

  return {
    name: 'jess',
    enforce: 'pre',

    /* Vite calls this; Rollup does not. */
    configResolved(config) {
      viteRoot = config.root;
    },

    /* A CSS id is no file, so Vite's watcher can't reach it: an edit to the stylesheet updates it too. */
    handleHotUpdate({ file, modules, server }) {
      const css = server.moduleGraph.getModuleById(cssId(file));
      return css === undefined ? [...modules] : [...modules, css];
    },

    async resolveId(source, importer) {
      const sheet = sheetOf(sheets, viteRoot, source);
      if (sheet !== undefined) {
        return sheet;
      }
      if (importer?.startsWith(MODULE)) {
        const file = importer.slice(MODULE.length, -'.js'.length);
        return (await this.resolve(source, file, { skipSelf: true })) ?? this.resolve(source, ANCHOR, { skipSelf: true });
      }
      const inline = viteRoot !== undefined && source.endsWith(INLINE);
      const request = inline ? source.slice(0, -INLINE.length) : source;
      if (!LANGUAGES.has(path.extname(request))) {
        return null;
      }
      const resolved = await this.resolve(request, importer, { skipSelf: true });
      if (resolved === null || resolved.external) {
        return resolved;
      }
      if (inline) {
        sheets.set(cssId(resolved.id), resolved.id);
        return `${cssId(resolved.id)}${INLINE}`;
      }
      return `${MODULE}${resolved.id}.js`;
    },

    async load(id) {
      const [css = id] = id.split('?', 1);
      const sheet = sheets.get(css);
      if (sheet !== undefined) {
        return (await render(this, sheet)).css;
      }
      if (!id.startsWith(MODULE)) {
        return null;
      }
      const file = id.slice(MODULE.length, -'.js'.length);
      const result = await render(this, file);
      let cssImport: string | undefined;
      if (viteRoot !== undefined) {
        cssImport = cssId(file);
        sheets.set(cssImport, file);
      } else if (emitCss) {
        this.emitFile({ type: 'asset', fileName: cssFileName(file), source: result.css });
      }
      return { code: moduleCode(result.css, result.runtime, cssImport, options.colorNames === true), map: { mappings: '' } };
    }
  };
}

/** The CSS id a request names (dev URLs are root-relative), carrying the request's query. */
function sheetOf(sheets: ReadonlyMap<string, string>, viteRoot: string | undefined, source: string): string | undefined {
  const [request = source] = source.split('?', 1);
  const id = sheets.has(request) ? request : `${viteRoot}${request}`;
  return sheets.has(id) ? `${id}${source.slice(request.length)}` : undefined;
}

/** A stylesheet's render from its current source; its module and its CSS share one. */
function makeRender(config: Partial<ConfigOptions> | undefined): (context: PluginContext, file: string) => Promise<RenderResult> {
  const compiler = new Compiler();
  const renders = new Map<string, { source: string; result: RenderResult }>();
  return async (context, file) => {
    context.addWatchFile(file);
    const source = await readFile(file, 'utf8');
    let rendered = renders.get(file);
    if (rendered?.source !== source) {
      const result = await compiler.renderToResult(
        { filePath: file, source, language: LANGUAGES.get(path.extname(file))! },
        { ...config, suppressWarnings: true }
      );
      rendered = { source, result };
      renders.set(file, rendered);
      for (const warning of result.warnings) {
        context.warn(log(warning, file));
      }
    }
    const [error] = rendered.result.errors;
    if (error !== undefined) {
      context.error(log(error, file));
    }
    return rendered.result;
  };
}

function log(diagnostic: Diagnostic, file: string): RollupLog {
  return {
    message: diagnostic.message,
    id: file,
    ...(diagnostic.line > 0 ? { loc: { file: diagnostic.filePath ?? file, line: diagnostic.line, column: diagnostic.column } } : {})
  };
}

/** The stylesheet's JS module: its CSS, and the runtime when it exposes variables. */
export function moduleCode(css: string, runtime: ExportRuntimeData | undefined, cssImport?: string, colorNames = false): string {
  const modules = cssImport?.endsWith('.module.css') === true;
  const lines = cssImport === undefined ? [] : modules ? [`export * from ${JSON.stringify(cssImport)};`, `export { default } from ${JSON.stringify(cssImport)};`] : [`import ${JSON.stringify(cssImport)};`];
  if (runtime !== undefined) {
    const locals = new Map<string, string>();
    const imports = new Map<string, string[]>();
    const local = (module: string, name: string): string => {
      const key = `${module}\n${name}`;
      let id = locals.get(key);
      if (id === undefined) {
        id = `f${locals.size}`;
        locals.set(key, id);
        imports.set(module, [...imports.get(module) ?? [], `${name} as ${id}`]);
      }
      return id;
    };
    const write = (recipe: ExportRecipe | ExportColor | string): string =>
      typeof recipe === 'string' || 'export' in recipe
        ? JSON.stringify(recipe)
        : 'color' in recipe
          ? `[${local('@jesscss/fns/runtime', 'color')}(${JSON.stringify(recipe.color)}, ${JSON.stringify(recipe.rgb)}, ${recipe.alpha}), []]`
          : `[${local(recipe.fn.module, recipe.fn.name)}, [${recipe.args.map(write).join(', ')}]]`;
    const derived = Object.entries(runtime.derived).map(([name, recipe]) => `${JSON.stringify(name)}: ${write(recipe)}`);

    /* The least check the exports need: none when no CSS form reads one. */
    const hold = runtime.ratios.length > 0 ? 'holdRatio' : Object.keys(runtime.units).length > 0 ? 'checkUnit' : undefined;
    if (derived.length === 0) {
      /* Two exports, so a page that imports only `vars` drops the writer. */
      const spec = hold === undefined ? { keys: runtime.keys } : hold === 'checkUnit' ? { keys: runtime.keys, units: runtime.units } : { keys: runtime.keys, units: runtime.units, ratios: runtime.ratios };
      const held = hold === undefined ? '' : `, ${hold}`;
      lines.push(
        `import { exposedVars${held}, writeVars } from '@jesscss/patch-css';`,
        `const spec = ${JSON.stringify(spec)};`,
        `export const vars = (values) => exposedVars(spec, values${held});`,
        `export const set = (values, target) => writeVars(exposedVars(spec, values${held}), target);`
      );
    } else {
      /* Names are read when asked for, or when the stylesheet itself writes one the runtime reads: a colour export's value, or a recipe's own argument. */
      const names = colorNames || runtime.names;
      const held = hold === undefined ? '' : `, hold: ${local('@jesscss/patch-css', hold)}`;
      lines.push(`import { createVars, ${names ? 'sniffLiteral' : 'sniffUnnamed'} as literal } from '@jesscss/fns/runtime';`, `import { writeVars } from '@jesscss/patch-css';`);
      for (const [module, members] of imports) {
        lines.push(`import { ${members.join(', ')} } from ${JSON.stringify(module)};`);
      }

      /* The hex check stays the ruling's: off only when asked, or when a colour export's own value is a name (an identifier: a colour export's value is a colour). */
      const hex = colorNames || runtime.colors.some(name => /^[a-z]/i.test(runtime.defaults[name] ?? ''))
        ? ''
        : `, hex: ${JSON.stringify(Object.fromEntries(Object.entries(runtime.keys).filter(([, name]) => runtime.colors.includes(name)).map(([key, name]) => [name, key])))}`;
      lines.push(
        `export const vars = createVars({ keys: ${JSON.stringify(runtime.keys)}, defaults: ${JSON.stringify(runtime.defaults)}, units: ${JSON.stringify(runtime.units)}, ratios: ${JSON.stringify(runtime.ratios)}${held}${runtime.colors.length > 0 ? hex : ''}, literal, derived: { ${derived.join(', ')} } });`,
        `export const set = (values, target) => writeVars(vars(values), target);`
      );
    }
  }
  if (!modules) {
    lines.push(`export default ${JSON.stringify(css)};`);
  }
  return `${lines.join('\n')}\n`;
}
