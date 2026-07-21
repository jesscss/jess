import { describe, expect, it } from 'vitest';
import scssPlugin from '../src/index.js';

describe('scss-plugin direct AST parse route', () => {
  it('returns the canonical Stylesheet document for valid SCSS', () => {
    const plugin = scssPlugin();
    const result = plugin.safeParse!('test.scss', '.a { @extend .b.c; }');

    expect(result.errors).toHaveLength(0);
    expect(result.document).toMatchObject({
      type: 'Stylesheet',
      children: [{ type: 'Rule' }]
    });
  });

  it('normalizes direct parser syntax failures as parse diagnostics', () => {
    const plugin = scssPlugin();
    const result = plugin.safeParse!('test.scss', '.a { color: red;');

    expect(result.document).toBeUndefined();
    expect(result.errors).toMatchObject([{
      code: 'parse/syntax-error',
      phase: 'parse',
      filePath: 'test.scss',
      line: 1,
      column: 1
    }]);
  });
});
