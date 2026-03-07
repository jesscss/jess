import path from 'path';
import { Compiler, type ConfigOptions } from 'jess';
import type { Plugin } from 'rollup';

export type JessRollupPluginOptions = {
  /**
   * Options passed into the Jess compiler for each file.
   * (Use this to set output options, plugins, etc.)
   */
  config?: Partial<ConfigOptions>;
  /**
   * Emit a CSS asset alongside the JS module.
   * Default: true
   */
  emitCss?: boolean;
  /**
   * Emit file name for the CSS asset. Defaults to `<basename>.css`.
   */
  cssFileName?: (id: string) => string;
};

/**
 * Minimal, modern `rollup-plugin-jess`:
 * - Compiles `.jess` files via `jess`'s `Compiler.renderString()`
 * - Emits a CSS asset (default) and returns a JS module exporting the CSS string
 */
export default function jessRollupPlugin(options: JessRollupPluginOptions = {}): Plugin {
  const compiler = new Compiler();

  const emitCss = options.emitCss ?? true;
  const cssFileName = options.cssFileName ?? ((id: string) => `${path.basename(id, path.extname(id))}.css`);

  return {
    name: 'jess',
    async transform(code, id) {
      if (!id.endsWith('.jess')) return null;

      const css = await compiler.renderString(code, {
        filePath: id,
        extension: '.jess',
        config: options.config
      });

      if (emitCss) {
        this.emitFile({
          type: 'asset',
          fileName: cssFileName(id),
          source: css
        });
      }

      return {
        code: `export default ${JSON.stringify(css)};\n`,
        map: { mappings: '' }
      };
    }
  };
}