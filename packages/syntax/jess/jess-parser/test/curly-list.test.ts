import { describe, expect, it } from 'vitest';
import { parse } from '@jesscss/jess-parser';

/*
 * `.jess` `{ … }` is the curly list, a list passed as one value (owner
 * 2026-10-09: *"~(1px, 2px) would be parsed as `{1px, 2px}`"*, *"`~()` would no
 * longer be valid in .jess"*; 2026-10-23: *"those need to be separate for Jess
 * syntax (#{} vs {})"*): a `curly` `Block` written as what it holds, except as
 * a CSS call's argument, where its braces are CSS's own (css-values-5 §3.1.1).
 * A map is `#{ … }` (ledger P31).
 */
const valueOf = (source: string): unknown => {
  const rule = parse(source).rules[0];
  return rule !== undefined && 'value' in rule ? rule.value : undefined;
};
const declarationValue = (source: string): unknown => {
  const rule = parse(source).rules[0];
  const declaration = rule !== undefined && 'rules' in rule && Array.isArray(rule.rules) ? rule.rules[0] : undefined;
  return declaration !== undefined && 'value' in declaration ? declaration.value : undefined;
};

describe('.jess curly list', () => {
  it('parses `{ … }` as the curly list, written without its braces', () => {
    expect(valueOf('$l: {1, 2, 3};')).toMatchObject({ type: 'Block', delimiter: 'curly', escaped: true, value: { type: 'List', sep: ',' } });
    expect(valueOf('$l: {1 2};')).toMatchObject({ type: 'Block', delimiter: 'curly', escaped: true, value: [{ src: '1' }, { src: '2' }] });
    expect(declarationValue('.x { a: {1, 2}; }')).toMatchObject({ type: 'Block', delimiter: 'curly', escaped: true });
  });

  it('parses `{}` as the empty list and `{1,}` as a one-item comma list', () => {
    expect(valueOf('$l: {};')).toMatchObject({ type: 'Block', delimiter: 'curly', escaped: true, value: [] });
    expect(valueOf('$l: {1,};')).toMatchObject({ type: 'Block', delimiter: 'curly', value: { type: 'List', sep: ',', value: [{ src: '1' }] } });
  });

  it('nests curly lists', () => {
    expect(valueOf('$l: {{1, 2}, {3, 4}};')).toMatchObject({
      type: 'Block',
      value: { type: 'List', value: [{ type: 'Block', delimiter: 'curly' }, { type: 'Block', delimiter: 'curly' }] }
    });
  });

  it('reads `{ … }` in a `.jess` call\'s and a mixin call\'s arguments as the curly list', () => {
    expect(declarationValue('.x { a: $length({1, 2, 3}); }')).toMatchObject({
      type: 'Reference', steps: [{ type: 'Call', args: [{ value: { type: 'Block', delimiter: 'curly', escaped: true } }] }]
    });
    const call = parse('.x { $ > .m({1, 2}, 3); }').rules[0];
    expect(call).toMatchObject({ rules: [{ type: 'MixinCall', args: [{ value: { type: 'Block', delimiter: 'curly', escaped: true } }, { value: { src: '3' } }] }] });
  });

  it('keeps CSS\'s own braces on a CSS call\'s `{ … }` argument (css-values-5 §3.1.1)', () => {
    const value = declarationValue('.x { a: random-item(--x, {a, b}, c); }');
    expect(value).toMatchObject({ type: 'FunctionCall', args: [{}, { value: { type: 'Block', delimiter: 'curly' } }, {}] });
    expect(value).not.toMatchObject({ args: [{}, { value: { escaped: true } }, {}] });
  });

  it('reads `#{ … }` as a map, and a bare `{` holding entries is not one', () => {
    expect(valueOf('$m: #{ a: 1; b: 2; };')).toMatchObject({ type: 'Collection', entries: [{ key: { src: 'a' } }, { key: { src: 'b' } }] });
    expect(valueOf('$m: #{};')).toMatchObject({ type: 'Collection', entries: [] });
    expect(() => parse('$m: { a: 1; };')).toThrow();
  });

  it('no longer reads `~( … )`', () => {
    expect(() => parse('.x { a: ~(1, 2); }')).toThrow();
  });
});
