import { describe, it, expect } from 'vitest';
import { makeKeyword, makeQuoted } from '@jesscss/core/value';
import { lessFns } from '../registry.js';
import { e } from '../e.js';

describe('e()', () => {
  it('returns raw anonymous bytes for quoted and unquoted values', () => {
    const quoted = makeQuoted('hello');
    const ident = makeKeyword('world');

    expect(e(quoted)).toMatchObject({ type: 'Anonymous', bytes: 'hello' });
    expect(e(ident)).toMatchObject({ type: 'Anonymous', bytes: 'world' });
  });

  it('uses the canonical implementation registered for Less', () => {
    expect(lessFns.find(fn => fn.name === 'e')).toBe(e);
  });
});
