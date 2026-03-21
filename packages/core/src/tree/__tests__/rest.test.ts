import { describe, expect, it } from 'vitest';
import { any, rest } from '../index.js';

describe('Rest', () => {
  it('serializes string-backed rest params with the current wrapper shape', () => {
    expect(rest('args').toTrimmedString()).toBe('...$$args');
  });

  it('serializes node-backed rest params through the wrapped value', () => {
    expect(rest(any('args')).toTrimmedString()).toBe('...$args');
  });
});
