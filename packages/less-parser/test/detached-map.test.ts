import { Parser } from '../src/jess.js';

const parser = new Parser();
const parse = parser.parse;

describe('detached ruleset map with numeric keys (Bootstrap @grays)', () => {
  it('parses a var-assigned block with numeric declaration keys', () => {
    const src = '@grays: {\n  100: @gray-100;\n  200: @gray-200;\n};';
    const { errors } = parse(src, 'Stylesheet');
    expect(errors.map(e => e.message)).toEqual([]);
  });

  it('parses a numeric-key declaration inside a detached block', () => {
    const { errors } = parse('@m: { 1: a; };', 'Stylesheet');
    expect(errors.map(e => e.message)).toEqual([]);
  });
});

describe('detached ruleset with non-ident keys (Bootstrap @escaped-characters)', () => {
  // Bootstrap _variables.less:93. Less's detached-ruleset parser is permissive: a
  // `{ <: %3c; ... }` block with non-ident keys is captured as a raw block (a Quoted
  // string) and only re-parsed on interpolation. The structured declarationList branch
  // fails on these keys, so the grammar falls back to a raw balanced-scan and the
  // builder produces a `Quoted` holding the verbatim `{ … }` text — matching historical
  // Less and the `escape-svg` @plugin, which reads `@escaped-characters` as a string.
  it('parses a var-assigned block whose keys are special chars', () => {
    const src = '@escaped-characters: {\n\t<: %3c;\n\t>: %3e;\n\t#: %23;\n\t(: %28;\n\t): %29;\n};';
    const { errors, tree } = parse(src, 'Stylesheet');
    expect(errors.map(e => e.message)).toEqual([]);
    const decl = tree.rules[0] as any;
    expect(decl.type).toBe('VarDeclaration');
    expect(decl.value.type).toBe('Quoted');
    expect(String(decl.value.value)).toContain('<: %3c;');
  });

  it('still parses a valid-key detached ruleset as a structured Mixin', () => {
    const src = '@colors: {\n\tblue: #00f;\n\tred: #f00;\n};';
    const { errors, tree } = parse(src, 'Stylesheet');
    expect(errors.map(e => e.message)).toEqual([]);
    const decl = tree.rules[0] as any;
    expect(decl.type).toBe('VarDeclaration');
    expect(decl.value.type).toBe('Mixin');
  });
});
