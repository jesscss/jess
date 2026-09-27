import { describe, expect, it } from 'vitest';
import { parse } from '../src/index.js';
import { ESCAPED_AT_KEYWORDS, atRuleName } from '../../../../../test/escaped-at-keywords.js';

/* The shared cases and why they read this way: `test/escaped-at-keywords.ts`. */
describe('escaped at-keywords', () => {
  it.each(ESCAPED_AT_KEYWORDS)('reads %s as the whole escaped identifier', (source, name) => {
    expect(atRuleName(parse(source))).toBe(name);
  });
});
