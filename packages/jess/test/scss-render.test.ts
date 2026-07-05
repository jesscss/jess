import { describe, it, expect } from 'vitest';
import { Compiler } from '../src/index.js';
import scssPlugin from '@jesscss/plugin-scss';

/**
 * End-to-end coverage for the SCSS plugin: parse → eval → render to CSS.
 *
 * Regression guard for the root-rule casing bug — the plugin invoked
 * `parser.parse(source, 'stylesheet', …)` but the functional grammar's root
 * rule is `Stylesheet`, so `grammar['stylesheet']` was undefined and every
 * render threw "Cannot read properties of undefined (reading 'parse')". The
 * scss-parser tests are parse-only and never exercised this path.
 */
describe('scss plugin render-through', () => {
  it('renders `.scss` out of the box (default plugin, no config)', async () => {
    const compiler = new Compiler();
    const css = await compiler.renderString('.a { color: red; }', { extension: '.scss' });
    expect(css).toContain('.a');
    expect(css).toContain('color: red');
  });

  it('renders nested SCSS selectors by default', async () => {
    // Nesting is preserved (the scss plugin defaults collapseNesting to false).
    const compiler = new Compiler();
    const src = '.card { color: blue; .title { font-weight: bold; } }';
    const css = await compiler.renderString(src, { extension: '.scss' });
    expect(css).toContain('.card');
    expect(css).toContain('color: blue');
    expect(css).toContain('.title');
    expect(css).toContain('font-weight: bold');
  });

  it('honors an explicitly configured scss plugin', async () => {
    const compiler = new Compiler({
      compile: { plugins: [scssPlugin()] }
    });
    const css = await compiler.renderString('.a { color: red; }', { extension: '.scss' });
    expect(css).toContain('color: red');
  });
});
