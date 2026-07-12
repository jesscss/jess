import { describe, expect, it } from 'vitest';
import { rawrules, decl, any } from '../index.js';

describe('RawRules', () => {
  it('serializes children without parent-managed indentation or newlines', () => {
    const node = rawrules([
      decl({ name: 'color', value: any('red') }),
      decl({ name: 'background', value: any('blue') })
    ]);

    expect(node.toTrimmedString()).toBe('color: redbackground: blue');
    expect(node.toBraced()).toBe('{color: redbackground: blue}');
  });
});
