import { describe, expect, it } from 'vitest';
import jessPlugin from '../src/index.js';

describe('@jesscss/plugin-jess', () => {
  it('returns a canonical Stylesheet through safeParse', () => {
    const result = jessPlugin().safeParse!('entry.jess', '.entry { color: red; }');

    expect(result.errors).toEqual([]);
    expect(result.document?.type).toBe('Stylesheet');
  });
});
