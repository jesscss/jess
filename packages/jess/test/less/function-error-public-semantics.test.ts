import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/index.js';
import lessPlugin from '@jesscss/plugin-less';

const invalidCalls = [
  ['invalid color text', 'color("NOT A COLOR")'],
  ['non-number percentage expression', 'percentage(16/17)'],
  ['invalid svg-gradient direction', 'svg-gradient(horizontal, black, white)'],
  ['invalid svg-gradient stop shape', 'svg-gradient(to bottom, black, orange, 45%, white)'],
  ['missing svg-gradient direction', 'svg-gradient(black, orange)'],
  ['invalid svg-gradient list direction', 'svg-gradient(horizontal, @colors)', '@colors: black, white;'],
  ['invalid svg-gradient list stop shape', 'svg-gradient(to bottom, @colors)', '@colors: black, orange, 45%, white;'],
  ['missing svg-gradient direction in list form', 'svg-gradient(black, @colors)', '@colors: orange;'],
  ['non-number unit expression', 'unit(80/16, rem)'],
  ['invalid rgba single numeric argument', 'rgba(1)'],
  ['invalid rgba two-argument numeric call', 'rgba(1, 2)']
] as const;

describe('Less built-in argument errors through the public AST route', () => {
  it('evaluates a multiline final svg-gradient stop as one typed argument', async () => {
    const compiler = new Compiler({
      output: { collapseNesting: true },
      compile: { functionMode: 'error' }
    });
    const source = `
      @color: #800080;
      .gradient-mixin(@color) {
        background: svg-gradient(to bottom,
          fade(@color, 0%) 0%,
          fade(@color, 50%) 100%
        );
      }
      .result { .gradient-mixin(@color); }
    `;

    const output = await compiler.renderString(source, {
      filePath: 'entry.less',
      extension: '.less'
    });
    expect(output).toContain('background: url(\'data:image/svg+xml,');
    expect(output).toContain('offset%3D%22100%25%22');
    expect(output).not.toContain('svg-gradient(');
  });

  it('keeps all static CSS color calls deferred (comma spacing normalized) without dispatching an installed Less function', async () => {
    let calls = 0;
    const compiler = new Compiler({
      output: { collapseNesting: true },
      compile: {
        plugins: [lessPlugin({
          plugins: [{
            install(less: { functions: { functionRegistry: { add(name: string, fn: unknown): void } } }) {
              for (const name of ['rgb', 'rgba', 'hsl', 'hsla']) {
                less.functions.functionRegistry.add(name, () => {
                  calls += 1;
                  return 0;
                });
              }
            }
          }]
        })]
      }
    });
    const source = '.entry { a: rgb(1,2, 3); b: rgba(1, 2,3, .5); c: hsl(198deg,28%, 50%); d: hsla(198deg, 28%,50%, .5); }';

    /*
     * The call stays deferred (never dispatched — `calls` below is 0), but comma
     * spacing is minimal-correctness normalized to one space after each comma
     * (owner rule 2026-08-17): the authored tight/mixed spacing is NOT preserved.
     */
    await expect(compiler.renderString(source, { filePath: 'entry.less', extension: '.less' }))
      .resolves.toContain('a: rgb(1, 2, 3)');
    await expect(compiler.renderString(source, { filePath: 'entry.less', extension: '.less' }))
      .resolves.toContain('d: hsla(198deg, 28%, 50%, .5)');
    expect(calls).toBe(0);
  });

  it('keeps F5 literal and relative color calls deferred; only demanded values reach functionMode', async () => {
    const literalSource = '.entry { rgb: rgb(12.5%, 0%, 33.333%); hsl: hsl(198deg, 28%, 50%); }';
    const strict = new Compiler({ output: { collapseNesting: true }, compile: { functionMode: 'error' } });

    // F5: these are literal CSS value-functions, not eager native invocations.
    await expect(strict.renderString(literalSource, { filePath: 'entry.less', extension: '.less' }))
      .resolves.toContain('rgb: rgb(12.5%, 0%, 33.333%)');
    await expect(strict.renderString(literalSource, { filePath: 'entry.less', extension: '.less' }))
      .resolves.toContain('hsl: hsl(198deg, 28%, 50%)');

    const relativeSource = '.entry { color: rgb(from red r g b); }';
    const lenient = new Compiler({ output: { collapseNesting: true } });
    await expect(lenient.renderString(relativeSource, { filePath: 'entry.less', extension: '.less' }))
      .resolves.toContain('rgb(from red r g b)');
    await expect(strict.renderString(relativeSource, { filePath: 'entry.less', extension: '.less' }))
      .resolves.toContain('rgb(from red r g b)');

    /*
     * The inner relative color is now demanded by `lighten`, so rejection belongs
     * to the existing evaluator functionMode boundary—not to bare-call parsing.
     */
    const demandedSource = '.entry { color: lighten(rgb(from red r g b), 10%); }';
    await expect(lenient.renderString(demandedSource, { filePath: 'entry.less', extension: '.less' }))
      .resolves.toContain('lighten(rgb(from red r g b), 10%)');
    await expect(strict.renderString(demandedSource, { filePath: 'entry.less', extension: '.less' }))
      .rejects.toMatchObject({ code: 'eval/invalid-function' });

    const variableSource = '@h: 198deg; .entry { color: hsl(@h, 28%, 50%); }';
    await expect(strict.renderString(variableSource, { filePath: 'entry.less', extension: '.less' }))
      .resolves.toContain('color: hsl(198deg, 28%, 50%)');
  });

  it('dispatches Less color overloads instead of leaking CSS-shaped authored bytes', async () => {
    const compiler = new Compiler({ output: { collapseNesting: true } });
    const source = '.entry { color: rgba(#5F59); faded: rgba(#5F59, .5); hue: hsla(#5F59); }';
    const output = await compiler.renderString(source, {
      filePath: 'entry.less',
      extension: '.less'
    });
    expect(output).toContain('color: rgba(85, 255, 85, 0.6)');
    expect(output).toContain('faded: rgba(85, 255, 85, 0.5)');
    expect(output).toContain('hue: hsla(120, 100%, 66.66666667%, 0.6)');
    expect(output).not.toContain('rgba(#5F59)');
    expect(output).not.toContain('hsla(#5F59)');
  });

  it.each(['scss', 'jess'] as const)('does not apply the Less call policy to .%s documents', async (extension) => {
    const strict = new Compiler({ output: { collapseNesting: true }, compile: { functionMode: 'error' } });
    await expect(strict.renderString('.entry { color: rgb(1,2, 3); }', {
      filePath: `entry.${extension}`,
      extension: `.${extension}`
    })).resolves.toContain('color: rgb(1, 2, 3)');
  });

  it('rejects a top-level color constructor result as a statement', async () => {
    const compiler = new Compiler({ output: { collapseNesting: true } });
    await expect(compiler.renderString('rgba(0,0,0,0);', {
      filePath: 'entry.less',
      extension: '.less'
    })).rejects.toMatchObject({ code: 'eval/invalid-statement' });
  });

  it.each(invalidCalls)('reports %s in functionMode:error', async (_label, call, declarations = '') => {
    const compiler = new Compiler({
      output: { collapseNesting: true },
      compile: { functionMode: 'error' }
    });
    await expect(compiler.renderString(`${declarations}\n.entry { value: ${call}; }`, {
      filePath: 'entry.less',
      extension: '.less'
    })).rejects.toMatchObject({ code: 'eval/invalid-function' });
  });
});
