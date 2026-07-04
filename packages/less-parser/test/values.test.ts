import { serializeTypes, N, isNode, type Node } from '@jesscss/core';
import { Parser } from '../src/index.js';

const parser = new Parser();
const parse = parser.parse;

function asRuleset(n: Node | string | undefined): { rules: Node[] } {
  if (!isNode(n, N.Ruleset)) {
    throw new Error('Expected a ruleset');
  }
  return n;
}
function asFor(n: Node | string | undefined): { type: string; rules: Node[]; pattern: { kind: string; values: Node[] } } {
  // The For control node has no N enum bit; access its shape via a loose cast.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return n as unknown as { type: string; rules: Node[]; pattern: { kind: string; values: Node[] } };
}

describe('value', () => {
  it('should parse color value', () => {
    const { errors } = parse('color: red', 'declaration');
    expect(errors.length).toBe(0);
  });

  it('should parse dimension value', () => {
    const { errors } = parse('width: 10px', 'declaration');
    expect(errors.length).toBe(0);
  });

  it('should parse number value', () => {
    const { errors } = parse('opacity: 0.5', 'declaration');
    expect(errors.length).toBe(0);
  });

  it('should parse string value', () => {
    const { errors } = parse('content: "text"', 'declaration');
    expect(errors.length).toBe(0);
  });

  it('should parse function call value', () => {
    const { errors } = parse('color: rgb(255, 0, 0)', 'declaration');
    expect(errors.length).toBe(0);
  });

  it('should reject backtick javascript values', () => {
    // A parser must not throw — inline JS (removed in v5) is a graceful parse error.
    const { errors } = parse('.a { js: `1 + 1`; esc: ~`2 + 5 + "px"`; }', 'Stylesheet');
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors[0]!.message).toContain('Inline JavaScript using backticks is not supported');
  });

  it('should reject a trailing comma in a value list (stricter than Less 4.x)', () => {
    // A comma must be followed by a value; a dangling comma is a parse error in v5.
    expect(parse('@x: a, b, c,;', 'Stylesheet').errors.length).toBeGreaterThanOrEqual(1);
    expect(parse('.a { prop: 1, 2,; }', 'Stylesheet').errors.length).toBeGreaterThanOrEqual(1);
    // a well-formed comma list still parses cleanly
    expect(parse('@y: a, b, c;', 'Stylesheet').errors.length).toBe(0);
  });

  it('parses each() with a block callback into a For control node', () => {
    const { tree, errors } = parse(`
      .test {
        each(1 2 3 4, {
          padding+_: (@value * 10px);
        });
      }
    `, 'Stylesheet');

    expect(errors.length).toBe(0);
    const ruleset = asRuleset(tree.rules[0]);
    const eachNode = asFor(ruleset.rules[0]);
    expect(eachNode.type).toBe('For');
    expect(eachNode.pattern.kind).toBe('tuple');
    expect(eachNode.pattern.values.map((entry: any) => entry.name.valueOf())).toEqual(['value', 'key', 'index']);
    expect(eachNode.rules).toHaveLength(1);
  });

  it('preserves explicit each() callback params in the For pattern', () => {
    const { tree, errors } = parse(`
      each(a b, .(@v; @i) {
        x: @v @i;
      });
    `, 'declarationList');

    expect(errors.length).toBe(0);
    const eachNode = asFor(tree.rules[0]);
    expect(eachNode.type).toBe('For');
    expect(eachNode.pattern.kind).toBe('tuple');
    expect(eachNode.pattern.values.map((entry: any) => entry.name.valueOf())).toEqual(['v', 'i']);
  });
});

describe('valueSequence', () => {
  it('should parse sequence of values', () => {
    const { errors } = parse('margin: 10px 20px', 'declaration');
    expect(errors.length).toBe(0);
  });

  it('should parse single value (not sequence)', () => {
    const { errors } = parse('color: red', 'declaration');
    expect(errors.length).toBe(0);
  });

  it('treats obvious non-division slash values as slash lists', () => {
    const { tree, errors } = parse(
      `font: normal small/20px 'Trebuchet MS', Verdana, sans-serif`,
      'declaration'
    );

    expect(errors.length).toBe(0);
    const serialized = serializeTypes(tree, { showOptions: true });
    expect(serialized).toContain('small / 20px');
    expect(serialized).toContain('20px');
    expect(serialized).toContain('(Keyword [role=keyword]');
    expect(serialized).toContain('\'Verdana\'');
    expect(serialized).toContain('\'Trebuchet MS\'');
  });

  it('allows color-keyword slash values to remain division-like in math: always mode', () => {
    const alwaysParser = new Parser({ mathMode: 'always' });
    const { tree, errors } = alwaysParser.parse('color: red/2', 'declaration');

    expect(errors.length).toBe(0);
    const serialized = serializeTypes(tree, { showOptions: true });
    expect(serialized).toContain('(Operation');
    expect(serialized).toContain('node: \'red\'');
    expect(serialized).toContain('(Num 2)');
  });
});
