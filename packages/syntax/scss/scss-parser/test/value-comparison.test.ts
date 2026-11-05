import { describe, expect, it } from 'vitest';
import { parse } from '@jesscss/scss-parser';

/**
 * A comparison is an expression, so it is read wherever a value is. Each source
 * is taken from the file named beside it.
 */
const ACCEPTED: ReadonlyArray<readonly [string, string]> = [
  ['`and` over `==` in a call argument (Bootstrap mixins/_utilities.scss)', '$infix: if($property-class == "" and str-slice($infix, 1, 1) == "-", str-slice($infix, 2), $infix);'],
  ['`or` over `and` over `>` and `<` (Bootstrap vendor/_rfs.scss)', '@function divide($dividend, $divisor) { $sign: if($dividend > 0 and $divisor > 0 or $dividend < 0 and $divisor < 0, 1, -1); }'],
  ['a comparison in @return (sassy-lists _missing-dependencies.scss)', '@function f() { @return length($missing-dependencies) > 0; }'],
  ['`!=` chained with `and` in a call argument (sassy-lists _true.scss)', '@function sl-is-true($value) { @return if($value == null, false, $value and $value != null and $value != \'\' and $value != ()); }'],
  ['`!=` then a call in @return (Foundation util/_value.scss)', '@function -zf-bool($val) { @return $val != false and has-value($val); }'],
  ['`not(` over a comparison (Foundation util/_math.scss)', 'a { b: not(e == f or (g == h)); }'],
  ['a comparison in a paren group', '$r: ($a == null or $b);'],
  ['no space around the operator', '.a { b: 1<2; c: $a==1; }'],
  ['a quoted operator as an operand (Bootstrap _variables.scss)', '$escaped-characters: (("<", "%3c"), (">", "%3e"), ("#", "%23")) !default;'],
  ['a selector that opens like a declaration', 'a:hover > b { c: d; }']
];

describe('SCSS comparison in a value', () => {
  it.each(ACCEPTED)('accepts %s', (_label, source) => {
    expect(() => parse(source)).not.toThrow();
  });

  it('reads the comparison as a computation over a condition', () => {
    expect(parse('$x: $a == 1;')).toMatchObject({
      rules: [{ type: 'VariableDeclaration', value: { type: 'Expression', value: { type: 'Condition' } } }]
    });
  });

  it('keeps a space list whose first member is the comparison', () => {
    expect(parse('$x: $a == b c;')).toMatchObject({
      rules: [{ type: 'VariableDeclaration', value: [{ type: 'Expression' }, { type: 'Keyword' }] }]
    });
  });

  it('reads a comparison with nothing after it as the CSS it is', () => {
    expect(() => parse('.a { b: f(type(<length>)); }')).not.toThrow();
  });
});
