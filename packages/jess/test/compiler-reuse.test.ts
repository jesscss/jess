import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Compiler } from '../src/index.js';
import { lessCompatPlugin } from '@jesscss/plugin-less-compat';
import { Any, Rules, type Declaration, type VarDeclaration } from '@jesscss/core';

describe('Compiler reuse', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-compiler-reuse-'));
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('reuses the Less plugin when the effective Less options are identical', () => {
    const testFile = path.join(tempDir, 'same.less');
    fs.writeFileSync(testFile, '.a { width: (1 + 1) }');

    const compiler = new Compiler();
    const first = compiler.createContext(testFile);
    const second = compiler.createContext(testFile);

    const firstPlugin = first.plugins.find(plugin => plugin.name === 'less');
    const secondPlugin = second.plugins.find(plugin => plugin.name === 'less');

    expect(firstPlugin).toBeTruthy();
    expect(firstPlugin).toBe(secondPlugin);
  });

  it('creates a new Less plugin when the effective Less options change', () => {
    const testFile = path.join(tempDir, 'math.less');
    fs.writeFileSync(testFile, '.a { width: (1 + 1) }');

    const compiler = new Compiler();
    const first = compiler.createContext(testFile, {
      language: {
        less: {
          mathMode: 'always'
        }
      }
    });
    const second = compiler.createContext(testFile, {
      language: {
        less: {
          mathMode: 'parens'
        }
      }
    });

    const firstPlugin = first.plugins.find(plugin => plugin.name === 'less');
    const secondPlugin = second.plugins.find(plugin => plugin.name === 'less');

    expect(firstPlugin).toBeTruthy();
    expect(secondPlugin).toBeTruthy();
    expect(firstPlugin).not.toBe(secondPlugin);
  });

  it('resolves styles.config per render before deciding Less-plugin reuse', () => {
    const dirA = path.join(tempDir, 'a');
    const dirB = path.join(tempDir, 'b');
    fs.mkdirSync(dirA, { recursive: true });
    fs.mkdirSync(dirB, { recursive: true });

    fs.writeFileSync(path.join(dirA, 'styles.config.js'), 'module.exports = { output: { collapseNesting: true } };');
    fs.writeFileSync(path.join(dirB, 'styles.config.js'), 'module.exports = { output: { collapseNesting: false } };');

    const fileA = path.join(dirA, 'a.less');
    const fileB = path.join(dirB, 'b.less');
    fs.writeFileSync(fileA, '.a { color: red; }');
    fs.writeFileSync(fileB, '.b { color: blue; }');

    const compiler = new Compiler();
    const contextA = compiler.createContext(fileA);
    const contextB = compiler.createContext(fileB);

    const lessA = contextA.plugins.find(plugin => plugin.name === 'less');
    const lessB = contextB.plugins.find(plugin => plugin.name === 'less');

    expect(contextA.opts.collapseNesting).toBe(true);
    expect(contextB.opts.collapseNesting).toBe(false);
    expect(lessA).toBeTruthy();
    expect(lessB).toBeTruthy();
    expect(lessA).not.toBe(lessB);
  });

  it('creates a fresh less-compat plugin for each render context', () => {
    const testFile = path.join(tempDir, 'compat.less');
    fs.writeFileSync(testFile, '.a { color: red; }');

    const compiler = new Compiler({
      compile: {
        plugins: ['@jesscss/plugin-less-compat']
      }
    });

    const first = compiler.createContext(testFile);
    const second = compiler.createContext(testFile);

    const firstPlugin = first.plugins.find(plugin => plugin.name === 'less-compat' || plugin.name === '@jesscss/plugin-less-compat');
    const secondPlugin = second.plugins.find(plugin => plugin.name === 'less-compat' || plugin.name === '@jesscss/plugin-less-compat');

    expect(firstPlugin).toBeTruthy();
    expect(secondPlugin).toBeTruthy();
    expect(firstPlugin).not.toBe(secondPlugin);
  });

  it('uses the same post-processing path for render and renderToResult', async () => {
    const testFile = path.join(tempDir, 'post.less');
    const source = '.a { color: red; }';
    fs.writeFileSync(testFile, source);

    const compiler = new Compiler({
      compile: {
        plugins: [
          lessCompatPlugin({
            plugins: [{
              install(_less: unknown, manager: { addPostProcessor: (processor: { process: (css: string) => string }) => void }) {
                manager.addPostProcessor({
                  process(css: string) {
                    return `${css}\n/* postprocessed */`;
                  }
                });
              }
            }]
          })
        ]
      }
    });

    const rendered = await compiler.render(testFile);
    const result = await compiler.renderToResult({ source, filePath: testFile, language: 'less', extension: '.less' });

    expect(rendered).toContain('postprocessed');
    expect(result.css).toBe(rendered);
  });

  it('runs postEvalVisitor before render serialization', async () => {
    const source = '@tone: red;\n.a { color: @tone; }';
    const compiler = new Compiler({
      compile: {
        plugins: [{
          name: 'pre-render-visitor-test',
          postEvalVisitor: {
            declaration(node: Declaration) {
              if (node.name.valueOf() === 'color') {
                node.value = new Any('blue', { role: 'keyword' });
              }
            }
          }
        }]
      }
    });

    const css = await compiler.renderString(source, { language: 'less' });

    expect(css).toContain('color: blue');
    expect(css).not.toContain('color: red');
  });

  it('runs preRenderVisitor before render serialization', async () => {
    const source = '@tone: red;\n.a { color: @tone; }';
    const compiler = new Compiler({
      compile: {
        plugins: [{
          name: 'pre-render-visitor-test',
          preRenderVisitor: {
            declaration(node: Declaration) {
              if (node.name.valueOf() === 'color') {
                node.value = new Any('green', { role: 'keyword' });
              }
            }
          }
        }]
      }
    });

    const css = await compiler.renderString(source, { language: 'less' });

    expect(css).toContain('color: green');
    expect(css).not.toContain('color: red');
  });

  it('runs typed beforeEvalVisitor before variable resolution', async () => {
    const source = '@tone: red;\n.a { color: @tone; }';
    const compiler = new Compiler({
      compile: {
        plugins: [{
          name: 'before-eval-visitor-test',
          beforeEvalVisitor: {
            varDeclaration(node: VarDeclaration) {
              if (node.name.valueOf() === 'tone') {
                node.value = new Any('blue', { role: 'keyword' });
              }
            }
          }
        }]
      }
    });

    const css = await compiler.renderString(source, { language: 'less' });

    expect(css).toContain('color: blue');
    expect(css).not.toContain('color: red');
  });

  it('renders root kept output through safeRender', async () => {
    const testFile = path.join(tempDir, 'root-output.less');
    fs.writeFileSync(testFile, '@charset "UTF-8";\n@import url("test.css");\n.a { color: red; }');

    const compiler = new Compiler({
      output: { collapseNesting: true },
      compile: {
        plugins: [lessCompatPlugin()]
      }
    });

    const result = await compiler.safeRender(testFile);

    expect(result.css).toContain('@charset "UTF-8";');
    expect(result.css).toContain('@import url("test.css");');
    expect(result.css).toContain('.a');
  });

  it('safeRender owns render without delegating through safeCompile', async () => {
    const testFile = path.join(tempDir, 'safe-render.less');
    fs.writeFileSync(testFile, '.a { color: red; }');

    class RenderOnlyCompiler extends Compiler {
      override async safeCompile(): Promise<never> {
        throw new Error('safeRender should not call safeCompile');
      }
    }

    const compiler = new RenderOnlyCompiler({
      output: { collapseNesting: true },
      compile: {
        plugins: [lessCompatPlugin()]
      }
    });

    const result = await compiler.safeRender(testFile);

    expect(result.errors).toEqual([]);
    expect(result.css).toContain('color: red');
  });

  it('keeps root output on public render APIs', async () => {
    const source = '@charset "UTF-8";\n@import url("test.css");\n.a { color: red; }';
    const testFile = path.join(tempDir, 'public-root-output.less');
    fs.writeFileSync(testFile, source);

    const compiler = new Compiler({
      output: { collapseNesting: true },
      compile: {
        plugins: [lessCompatPlugin()]
      }
    });

    const rendered = await compiler.render(testFile);
    const renderedString = await compiler.renderString(source, {
      filePath: testFile,
      language: 'less',
      extension: '.less'
    });
    const result = await compiler.renderToResult({
      source,
      filePath: testFile,
      language: 'less',
      extension: '.less'
    });

    for (const css of [rendered, renderedString, result.css]) {
      expect(css).toContain('@charset "UTF-8";');
      expect(css).toContain('@import url("test.css");');
      expect(css).toContain('.a');
    }
  });

  it('public render APIs drive root eval through render', async () => {
    // D3: `render()` is the sole eval driver. The root enters `render()`
    // UNEVALUATED (no separate pre-pass eval) and render evaluates it — so it is
    // evaluated by the time the render call resolves.
    //
    // NOTE (cutover P2): a spine-ELIGIBLE root is rendered by the single-pass
    // spine WITHOUT any `eval` (that is the wire-in — no eval pass, no output
    // tree; `evaluated` stays false), so this D3 eval-driver contract is now
    // exercised with a root the spine does NOT cover. An `:extend` INSIDE an
    // `@media` at-rule keeps the root on the eval path (at-rule-scoped extend
    // gather is an EXTEND HARD-TAIL residual — the static gather does not descend
    // into at-rule bodies), so render still drives eval to completion exactly as
    // the pre-pass used to. (A plain root-level `:extend` now FOLDS on the spine.)
    const source = '.base { color: red; }\n@media (tv) {\n  .a:extend(.base) { font-weight: bold; }\n}';
    const testFile = path.join(tempDir, 'evaluated-render-root.less');
    fs.writeFileSync(testFile, source);
    const originalRender = Rules.prototype.render;
    const entryStates: boolean[] = [];
    const exitStates: boolean[] = [];
    Rules.prototype.render = function renderForCounting(
      this: Rules,
      ...args: Parameters<typeof originalRender>
    ): ReturnType<typeof originalRender> {
      const self = this;
      entryStates.push(self.evaluated);
      const result = originalRender.apply(self, args);
      // Record the evaluated state once render settles (public render APIs are
      // async here). Promise.resolve unifies the sync/async return without a cast.
      void Promise.resolve(result).then(() => {
        exitStates.push(self.evaluated);
      });
      return result;
    };

    try {
      const compiler = new Compiler({
        output: { collapseNesting: true },
        compile: {
          plugins: [lessCompatPlugin()]
        }
      });

      await compiler.render(testFile);
      await compiler.renderString(source, {
        filePath: testFile,
        language: 'less',
        extension: '.less'
      });
      await compiler.renderToResult({
        source,
        filePath: testFile,
        language: 'less',
        extension: '.less'
      });

      // One root render() per public API call: it entered unevaluated (no
      // separate pre-pass eval) and render drove eval to completion.
      expect(entryStates).toEqual([false, false, false]);
      expect(exitStates).toEqual([true, true, true]);
    } finally {
      Rules.prototype.render = originalRender;
    }
  });
});
