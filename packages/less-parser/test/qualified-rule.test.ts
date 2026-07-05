import { Parser } from '../src/index.js';

const parser = new Parser();
const parse = parser.parse;

describe('qualifiedRule', () => {
  it('should parse qualified rule with selector', () => {
    const { errors } = parse('.selector { color: red; }', 'MixinOrQualifiedRule');
    expect(errors.length).toBe(0);
  });

  it('should parse qualified rule with guard', () => {
    const { errors } = parse('.light when (lightness(@a) > 50%) { color: green; }', 'MixinOrQualifiedRule');
    expect(errors.length).toBe(0);
  });

  it('should parse qualified rule with interpolation in selector', () => {
    const { errors } = parse('.qw@{ident} { foo: bar; }', 'Stylesheet');
    expect(errors.length).toBe(0);
  });
});

describe('qualifiedRuleBody', () => {
  it('should parse rule body with declarations', () => {
    const { errors } = parse('.test { color: red; margin: 10px; }', 'Stylesheet');
    expect(errors.length).toBe(0);
  });

  it('should parse rule body with nested rules', () => {
    const { errors } = parse('.parent { .child { color: red; } }', 'Stylesheet');
    expect(errors.length).toBe(0);
  });
});
