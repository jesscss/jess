import { describe, expect, it } from 'vitest';
import { parse } from '@jesscss/jess-parser';
import { bare } from '../../../../../test/provenance-free.js';

/**
 * `~( … )` (owner 2026-10-09: "Jess is supposed to support ~()") is a paren
 * block with its delimiters escaped: the one `.jess` spelling of a comma list
 * passed as ONE call argument. It is the `Block` Less's `~( … )` builds.
 */
const ruleOf = (source: string) => {
  const [rule] = parse(source).rules;
  if (rule?.type !== 'Ruleset') {
    throw new Error('expected one ruleset');
  }
  return rule.rules[0];
};
const kw = (src: string) => ({ type: 'Keyword', src });
const escaped = (value: unknown) => ({ type: 'Block', value, delimiter: 'paren', escaped: true });

describe('.jess `~( … )`', () => {
  it('is an escaped paren block around a comma list or a space list in a value', () => {
    expect(bare(ruleOf('.x { a: ~(a, b, c); }'))).toMatchObject({
      value: escaped({ type: 'List', sep: ',', value: [kw('a'), kw('b'), kw('c')] })
    });
    expect(bare(ruleOf('.x { a: ~(a b); }'))).toMatchObject({ value: escaped([kw('a'), kw('b')]) });
  });

  it('is one mixin argument, named or positional', () => {
    expect(bare(ruleOf('.x { $ > .t($a: ~(d, e), f); }'))).toMatchObject({
      type: 'MixinCall',
      args: [
        { name: 'a', value: escaped({ type: 'List', sep: ',', value: [kw('d'), kw('e')] }) },
        { name: undefined, value: kw('f') }
      ]
    });
  });

  it('is one function argument and one parameter default', () => {
    expect(bare(ruleOf('.x { a: foo(~(1, 2), 3); }'))).toMatchObject({
      value: { type: 'FunctionCall', args: [{ value: { type: 'Block', escaped: true } }, { value: { type: 'Dimension' } }] }
    });
    expect(bare(parse('.m($a: ~(1, 2)) { b: $a; }').rules[0])).toMatchObject({
      type: 'MixinDefinition',
      params: [{ name: 'a', default: { type: 'Block', escaped: true, delimiter: 'paren' } }]
    });
  });

  it('leaves a plain paren block and an escaped string as they were', () => {
    const value = (source: string) => {
      const rule = ruleOf(source);
      return rule?.type === 'Declaration' ? bare(rule.value) : undefined;
    };
    expect(value('.x { a: (a, b); }')).toEqual({ type: 'Block', value: { type: 'List', sep: ',', value: [kw('a'), kw('b')] }, delimiter: 'paren' });
    expect(value('.x { a: ~"q"; }')).toMatchObject({ type: 'Quoted', escaped: true, value: 'q' });
  });
});
