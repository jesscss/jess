import { Parser } from '../src/index.js';

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
  // KNOWN GAP (Bootstrap _variables.less:93). Less's detached-ruleset parser is
  // permissive: a `{ <: %3c; ... }` block with non-ident keys is captured as a raw
  // block and only stringified on interpolation. Jess parses detached bodies as a
  // structured declarationList, so these keys fail. Fixing needs a raw-block model,
  // and the sole consumer (`escape-svg`) is a less.js-runtime `@plugin` JS function
  // anyway — see LESS-INTEGRATION Milestone-4 report. Left as .todo pending that work.
  it.todo('parses a var-assigned block whose keys are special chars', () => {
    const src = '@escaped-characters: {\n\t<: %3c;\n\t>: %3e;\n\t#: %23;\n\t(: %28;\n\t): %29;\n};';
    const { errors } = parse(src, 'Stylesheet');
    expect(errors.map(e => e.message)).toEqual([]);
  });
});
