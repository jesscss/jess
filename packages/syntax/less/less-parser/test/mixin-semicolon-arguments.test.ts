import { describe, expect, it } from 'vitest';
import { valueLayoutOf } from '../../../../core/src/ast/provenance.js';
import { LessMixinArgumentError, parse } from '@jesscss/less-parser';
import { bare } from '../../../../../test/provenance-free.js';

/**
 * Less's `;` rule for mixin calls and definitions (owner 2026-10-09, ledger
 * P45): when the list holds any `;`, `;` separates its arguments and EVERY `,`,
 * before or after the `;`, belongs to a comma-list value. Without a `;`, `,`
 * separates arguments. The comma list is stored as the node `~( … )` builds,
 * so each `;` form parses to exactly what its escaped spelling does.
 */
const same = (semicolons: string, escaped: string) => {
  const a = parse(semicolons);
  const b = parse(escaped);
  expect(bare(a)).toEqual(bare(b));
  return a;
};

/** The first error `parse()` raises, with the source it underlines. */
const rejection = (source: string) => {
  try {
    parse(source);
  } catch (error) {
    if (!(error instanceof LessMixinArgumentError)) {
      throw error;
    }
    return { message: error.message, code: error.code, at: source.slice(error.offset, error.endOffset) };
  }
  throw new Error(`expected ${source} to be rejected`);
};

describe('Less mixin calls with a `;` (P45)', () => {
  it.each([
    ['.x { .t(@a : a; @b : b, c); }', '.x { .t(@a: a, @b: ~(b, c)); }'],
    ['.x { .t(@a : d, e; @b : f); }', '.x { .t(@a: ~(d, e), @b: f); }'],
    ['.x { .t(o, p; q); }', '.x { .t(~(o, p), q); }'],
    ['.x { .t(r, s; t;); }', '.x { .t(~(r, s), t); }'],
    ['.x { .t(m, n;); }', '.x { .t(~(m, n)); }'],
    ['.x { .t(@a : h;); }', '.x { .t(@a: h); }'],
    ['.x { .t(a, b; @c: d, e; f); }', '.x { .t(~(a, b), @c: ~(d, e), f); }'],
    ['.x { .t(@x, b; c); }', '.x { .t(~(@x, b), c); }'],
    ['.x { .t(0; @x...); }', '.x { .t(0, @x...); }'],
    ['.x { #ns > .t(@a: d, e; @b: f); }', '.x { #ns > .t(@a: ~(d, e), @b: f); }'],
    ['@r: .t(@a: d, e; @b: f);', '@r: .t(@a: ~(d, e), @b: f);'],
    ['.x { @dr(1; 2, 3); }', '.x { @dr(1, ~(2, 3)); }']
  ])('%s holds what %s does', (semicolons, escaped) => {
    same(semicolons, escaped);
  });

  it('keeps the authored separator layout `~( … )` keeps', () => {
    const document = same('.x { .t(o,\n    p; q); }', '.x { .t(~(o,\n    p), q); }');
    const [ruleset] = document.rules;
    if (ruleset?.type !== 'Ruleset' || ruleset.rules[0]?.type !== 'MixinCall') {
      throw new Error('expected a ruleset holding one mixin call');
    }
    const value = ruleset.rules[0].args[0]!.value;
    if (Array.isArray(value) || value.type !== 'Block' || Array.isArray(value.value)) {
      throw new Error('expected a block argument');
    }
    expect(valueLayoutOf(value.value)).toEqual([',\n    ']);
  });
});

describe('Less mixin definitions with a `;` (P45)', () => {
  it.each([
    ['.m(@color; @padding; @margin: 2, 2, 2, 2) { margin: @margin; }', '.m(@color, @padding, @margin: ~(2, 2, 2, 2)) { margin: @margin; }'],
    ['.m(@margin: 2, 2, 2, 2;) { margin: @margin; }', '.m(@margin: ~(2, 2, 2, 2)) { margin: @margin; }'],
    ['.m(@a; @rest...) { a: @a; }', '.m(@a, @rest...) { a: @a; }'],
    ['.m(a, b; @c) { c: @c; }', '.m(~(a, b), @c) { c: @c; }']
  ])('%s holds what %s does', (semicolons, escaped) => {
    same(semicolons, escaped);
  });
});

describe('Less mixin lists without a `;` keep `,` as the argument separator', () => {
  it('passes each comma item as its own argument', () => {
    expect(bare(parse('.x { .t(a, b); .t(@a: x, @b: y); .t(@a: a, 21, 22); }'))).toMatchObject({
      rules: [{
        rules: [
          { args: [{ value: { src: 'a' } }, { value: { src: 'b' } }] },
          { args: [{ name: 'a', value: { src: 'x' } }, { name: 'b', value: { src: 'y' } }] },
          { args: [{ name: 'a' }, { value: { number: 21 } }, { value: { number: 22 } }] }
        ]
      }]
    });
  });

  it('declares each comma item as its own parameter', () => {
    expect(bare(parse('.m(@a: 1, 2) { a: @a; }'))).toMatchObject({
      rules: [{ params: [{ name: 'a', default: { number: 1 } }, { pattern: { number: 2 } }] }]
    });
  });
});

describe('Less mixin list errors point at the argument', () => {
  it.each([
    ['.x { .t(@a: x, @b: y; z); }', 'A named argument must start its ;-separated argument.', '@b: y'],
    ['.x { .t(a, @x...; b); }', 'A spread or rest argument cannot be part of a comma list.', '@x...'],
    ['.m(@a, ...; @b) { a: @a; }', 'A spread or rest argument cannot be part of a comma list.', '...'],
    ['.x { .t(@a: 1, @b: 2; c, @d...); }', 'A named argument must start its ;-separated argument.', '@b: 2'],
    ['.x { .t(...); }', 'A mixin call cannot pass "..." on its own.', '...']
  ])('%s', (source, message, at) => {
    expect(rejection(source)).toEqual({ message, code: 'parse/invalid-mixin-argument', at });
  });

  it('accepts in a comma list what only a `;` list rejects', () => {
    expect(() => parse('.x { .t(@a: x, @b: y); .t(a, @x...); }')).not.toThrow();
  });
});
