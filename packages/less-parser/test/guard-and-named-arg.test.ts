import { Parser } from '../src/index.js';

const parser = new Parser();
const parse = parser.parse;

/**
 * Regressions surfaced by tests-config/namespacing/namespacing-3 and -7:
 *
 *  - A named mixin arg with a space-separated value (`.m(@b: 40px 10px)`) was
 *    built with a bare Component ARRAY on `VarDeclaration.value` — the callable
 *    binding path then crashed on `value.hasFlag(...)`, dropping the whole render
 *    (namespacing-3 lost all output). The value must be a single Node (Sequence).
 *
 *  - Bare-keyword guard operands (`when (foo = foo)`, `when (true)`) are LEAF
 *    tokens, not nodes, so the guard builder dropped them and produced an empty
 *    Keyword instead of a Condition. Operands must be reconstructed from the
 *    ordered child stream.
 *
 *  - A namespace lookup in a guard comparison (`when (#ns.opts[flag] = true)`)
 *    must parse the `#ns.opts[flag]` NsAccessor as ONE operand so the `= true`
 *    forms a comparison, not a value-Paren Sequence (namespacing-7 `.output-2`).
 */
describe('mixin named-arg values are single nodes', () => {
  const namedArg = (src: string): any => {
    const { errors, tree } = parse(src, 'Stylesheet');
    expect(errors.map(e => e.message)).toEqual([]);
    const call = (tree.rules[0] as any).rules[0];
    const args = call.args;
    return args.value[0];
  };

  it('wraps a space-separated named-arg value in a Sequence (not a bare array)', () => {
    const arg = namedArg('.class { .m(@b: 40px 10px); }');
    expect(arg.type).toBe('VarDeclaration');
    expect(Array.isArray(arg.value)).toBe(false);
    expect(arg.value.type).toBe('Sequence');
    expect(arg.value.value.map((n: any) => n.type)).toEqual(['Dimension', 'Dimension']);
    // The callable-binding path requires a single Node with `hasFlag`.
    expect(typeof arg.value.hasFlag).toBe('function');
  });

  it('keeps a single-token named-arg value a bare node', () => {
    const arg = namedArg('.class { .m(@b: 40px); }');
    expect(arg.type).toBe('VarDeclaration');
    expect(arg.value.type).toBe('Dimension');
  });
});

describe('guards with bare-keyword and namespace operands', () => {
  const guard = (src: string): any => {
    const { errors, tree } = parse(src, 'Stylesheet');
    expect(errors.map(e => e.message)).toEqual([]);
    return (tree.rules[0] as any).guard;
  };

  it('parses a bare boolean guard as a keyword operand (not an empty keyword)', () => {
    const g = guard('.a when (true) { c: d; }');
    // GuardInParens wraps the operand in a Paren.
    expect(g.type).toBe('Paren');
    expect(String(g.value.value)).toBe('true');
  });

  it('parses a keyword = keyword comparison', () => {
    const g = guard('.a when (foo = foo) { c: d; }');
    expect(g.type).toBe('Paren');
    const cond = g.value;
    expect(cond.type).toBe('Condition');
    expect(cond.operator).toBe('=');
    expect(String(cond.left.value)).toBe('foo');
    expect(String(cond.right.value)).toBe('foo');
  });

  it('parses a namespace lookup = true comparison as a Condition', () => {
    const g = guard('.a when (#ns.options[option] = true) { c: d; }');
    expect(g.type).toBe('Paren');
    const cond = g.value;
    expect(cond.type).toBe('Condition');
    expect(cond.operator).toBe('=');
    // Left operand is the reassembled namespace-accessor Reference.
    expect(cond.left.type).toBe('Reference');
  });
});
