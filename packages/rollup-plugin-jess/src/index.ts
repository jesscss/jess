import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Compiler, type ConfigOptions } from 'jess';
import type { Plugin, RollupLog } from 'rollup';

type RenderResult = Awaited<ReturnType<Compiler['renderToResult']>>;
type ExportRuntimeData = NonNullable<RenderResult['runtime']>;
type ExportRecipe = ExportRuntimeData['derived'][string];
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
};

const LANGUAGES: ReadonlyMap<string, string> = new Map([['.jess', 'jess'], ['.less', 'less']]);

/** A stylesheet's JS module (`<prefix><file>.js`), and its CSS under Vite: ids no CSS plugin claims. */
const MODULE = '\0jess:';
/** A CSS Modules stylesheet; under Vite its CSS id keeps the `.module.css` ending, so Vite's CSS Modules scope it. */
const MODULES = /\.module\.[^./]+$/;
const CSS = '\0jess-css:';

/** Where the runtime's own imports (`@jesscss/fns/…`) resolve from: this package, which depends on them. */
const ANCHOR = fileURLToPath(import.meta.url);

/**
 * `rollup-plugin-jess`: compiles `.jess` and `.less` imports with the `jess`
 * compiler. The module's default export is the CSS; the CSS is also emitted as
 * an asset (Rollup) or imported (Vite). A stylesheet that exports variables
 * (`@export @brand: #c00;`) also exports `vars(values)` and `set(values,
 * target?)` from `@jesscss/fns/runtime`, which recompute what depends on them
 * (docs/architecture/core/spec/R8-browser-runtime.md).
 */
export default function jessRollupPlugin(options: JessRollupPluginOptions = {}): Plugin & { enforce: 'pre'; configResolved(): void } {
  const compiler = new Compiler();
  const emitCss = options.emitCss ?? true;
  const cssFileName = options.cssFileName ?? ((id: string) => `${path.basename(id, path.extname(id))}.css`);
  const styles = new Map<string, string>();
  let vite = false;

  return {
    name: 'jess',
    enforce: 'pre',

    /* Vite calls this; Rollup does not. */
    configResolved() {
      vite = true;
    },

    async resolveId(source, importer) {
      if (source.startsWith(CSS)) {
        return source;
      }
      if (importer?.startsWith(MODULE)) {
        const file = importer.slice(MODULE.length, -'.js'.length);
        return (await this.resolve(source, file, { skipSelf: true })) ?? this.resolve(source, ANCHOR, { skipSelf: true });
      }
      if (!LANGUAGES.has(path.extname(source))) {
        return null;
      }
      const resolved = await this.resolve(source, importer, { skipSelf: true });
      return resolved === null || resolved.external ? resolved : `${MODULE}${resolved.id}.js`;
    },

    async load(id) {
      if (id.startsWith(CSS)) {
        return styles.get(id) ?? null;
      }
      if (!id.startsWith(MODULE)) {
        return null;
      }
      const file = id.slice(MODULE.length, -'.js'.length);
      this.addWatchFile(file);
      const result = await compiler.renderToResult(
        { filePath: file, source: await readFile(file, 'utf8'), language: LANGUAGES.get(path.extname(file))! },
        { ...options.config, suppressWarnings: true }
      );
      for (const warning of result.warnings) {
        this.warn(log(warning, file));
      }
      const [error] = result.errors;
      if (error !== undefined) {
        this.error(log(error, file));
      }
      let cssImport: string | undefined;
      if (vite) {
        cssImport = MODULES.test(file) ? `${CSS}${file.slice(0, -path.extname(file).length)}.css` : `${CSS}${file}.css`;
        styles.set(cssImport, result.css);
      } else if (emitCss) {
        this.emitFile({ type: 'asset', fileName: cssFileName(file), source: result.css });
      }
      return { code: moduleCode(result.css, result.runtime, cssImport), map: { mappings: '' } };
    }
  };
}

function log(diagnostic: Diagnostic, file: string): RollupLog {
  return {
    message: diagnostic.message,
    id: file,
    ...(diagnostic.line > 0 ? { loc: { file: diagnostic.filePath ?? file, line: diagnostic.line, column: diagnostic.column } } : {})
  };
}

/** The stylesheet's JS module: its CSS, and the runtime when it exports variables. */
export function moduleCode(css: string, runtime: ExportRuntimeData | undefined, cssImport?: string): string {
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
    const write = (recipe: ExportRecipe | string): string =>
      typeof recipe === 'string' || 'export' in recipe
        ? JSON.stringify(recipe)
        : `[${local(recipe.fn.module, recipe.fn.name)}, [${recipe.args.map(write).join(', ')}]]`;
    const derived = Object.entries(runtime.derived).map(([name, recipe]) => `${JSON.stringify(name)}: ${write(recipe)}`);
    lines.push(`import { createRuntime } from '@jesscss/fns/runtime';`);
    for (const [module, names] of imports) {
      lines.push(`import { ${names.join(', ')} } from ${JSON.stringify(module)};`);
    }
    lines.push(`export const { vars, set } = createRuntime({ defaults: ${JSON.stringify(runtime.defaults)}, derived: { ${derived.join(', ')} } });`);
  }
  if (!modules) {
    lines.push(`export default ${JSON.stringify(css)};`);
  }
  return `${lines.join('\n')}\n`;
}
