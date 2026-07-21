import { describe, expect, it } from 'vitest';
import { sourceSpanOf, variableReference, withSourceSpan } from '../../ast.js';

describe('canonical AST source provenance', () => {
  it('retains a Parseman reduction span without changing the AST node shape', () => {
    const ref = variableReference('tone', 'scoped');
    const keys = Object.keys(ref);

    expect(withSourceSpan(ref, { start: 8, end: 13 })).toBe(ref);
    expect(sourceSpanOf(ref)).toEqual({ start: 8, end: 13 });
    expect(Object.keys(ref)).toEqual(keys);
  });
});
