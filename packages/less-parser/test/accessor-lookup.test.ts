import { Parser } from '../src/index.js';

const parser = new Parser();
const parse = parser.parse;

/**
 * Regression: accessor lookups left un-evaluated because the parser produced a
 * literal instead of a structured accessor Reference.
 *
 * Fixtures: tests-config/namespacing/namespacing-operations.less (the
 * `#ns.options[val1] + …` namespace accessor split across an arithmetic
 * operation) and tests-unit/property-targeted/property-targeted.less (the bare
 * `$color` property accessor arriving as a raw string).
 */
describe('accessor lookups parse as structured References', () => {
  const decl = (src: string): any => {
    const { errors, tree } = parse(src, 'Stylesheet');
    expect(errors.map(e => e.message)).toEqual([]);
    return (tree.rules[0] as any).rules[0];
  };

  it('parses a bare $property accessor as an index Reference (not a literal string)', () => {
    const d = decl('.a { color: $color; }');
    const v = d.value as any;
    expect(v.type).toBe('Reference');
    expect(v.options.type).toBe('index');
    // `$color` → { key: Quoted('color') } with no target — resolved against scope.
    expect(v.target).toBeUndefined();
    expect(v.key.type).toBe('Quoted');
    expect(String(v.key.value)).toBe('color');
  });

  it('parses a namespace accessor in operation position as one operand', () => {
    // `#ns.options[val1] + 5px` must fold with the accessor as the Operation's
    // LEFT operand — not split into the bare string `#ns.options` + an Operation
    // whose left operand is a lone `[val1]`.
    const d = decl('.foo { val: #ns.options[val1] + 5px; }');
    const expr = d.value as any;
    expect(expr.type).toBe('Expression');
    const op = expr.value as any;
    expect(op.type).toBe('Operation');
    expect(op.operator).toBe('+');
    const left = op.left as any;
    expect(left.type).toBe('Reference');
    expect(left.key.type).toBe('Quoted');
    expect(String(left.key.value)).toBe('val1');
    // target is the mixin-ruleset name reference for `#ns.options`.
    expect(left.target.type).toBe('Reference');
    expect(left.target.options.type).toBe('mixin-ruleset');
    expect(left.target.key).toEqual(['#ns', '.options']);
  });

  it('still parses an isolated namespace accessor (no operation) as a Reference', () => {
    const d = decl('.foo { val: #ns.options[val1]; }');
    const v = d.value as any;
    expect(v.type).toBe('Reference');
    expect(String(v.key.value)).toBe('val1');
    expect(v.target.options.type).toBe('mixin-ruleset');
  });

  it('leaves a plain mixin call `.mixin()` on its existing path', () => {
    const d = decl('.foo { .mixin(); }');
    expect(d.type).toBe('Call');
  });
});
