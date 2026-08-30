import { describe, expect, it } from 'vitest';
import scssPlugin from '../src/index.js';

describe('scss-plugin direct AST parse route', () => {
  it('returns the canonical Stylesheet document for valid SCSS', () => {
    const plugin = scssPlugin({ unitMode: 'strict' });
    const result = plugin.safeParse!('test.scss', '.a { @extend .b.c; }');

    expect(result.errors).toHaveLength(0);
    expect(result.dialectDefaults).toEqual({ unitMode: 'strict' });
    expect(result.document).toMatchObject({
      type: 'Stylesheet',
      rules: [{ type: 'Ruleset' }]
    });

    expect(Object.keys(plugin)).not.toContain('dialectDefaults');
    expect(Object.isFrozen(result.dialectDefaults)).toBe(true);
    expect(Reflect.set(result.dialectDefaults!, 'unitMode', 'preserve')).toBe(false);
    expect(plugin.safeParse!('second.scss', '.b {}').dialectDefaults).toEqual({
      unitMode: 'strict'
    });
  });

  it('normalizes direct parser syntax failures as parse diagnostics', () => {
    const plugin = scssPlugin();
    const source = '.a { color: red; }\n!broken';
    const result = plugin.safeParse!('test.scss', source);

    expect(result.document).toBeUndefined();
    expect(result.errors).toMatchObject([{
      code: 'parse/syntax-error',
      phase: 'parse',
      filePath: 'test.scss',
      line: 2,
      column: 1,
      message: 'Unexpected SCSS input after a complete stylesheet.',
      file: { source }
    }]);
    expect(result.errors[0]?.lines?.[2]).toBe('!broken');
  });
});
