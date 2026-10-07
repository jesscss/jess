import { describe, expect, it } from 'vitest';
import jessPlugin from '../src/index.js';

describe('@jesscss/plugin-jess', () => {
  it('returns a canonical Stylesheet through safeParse', () => {
    const result = jessPlugin().safeParse!('entry.jess', '.entry { color: red; }');

    expect(result.errors).toEqual([]);
    expect(result.document?.type).toBe('Stylesheet');
  });

  it('defaults `unitMode` to `strict`, as a frozen dialect default a compile option overrides', () => {
    const result = jessPlugin().safeParse!('entry.jess', '.entry { k: $(1px + 3em); }');

    expect(result.dialectDefaults).toEqual({ unitMode: 'strict' });
    expect(Object.isFrozen(result.dialectDefaults)).toBe(true);
  });

  it('returns the direct parser failure at its actual source location', () => {
    const source = '.before { color: red; }\n!broken';
    const result = jessPlugin().safeParse!('entry.jess', source);

    expect(result.document).toBeUndefined();
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({
      code: 'parse/syntax-error',
      phase: 'parse',
      filePath: 'entry.jess',
      line: 2,
      column: 1,
      message: 'Unexpected Jess input after a complete stylesheet.',
      file: { source }
    });
    expect(result.errors[0]?.lines?.[2]).toContain('!broken');
  });
});
