import { serializeTypes } from '@jesscss/core';
import { Parser } from '../src/index.js';

const parser = new Parser();
const parse = parser.parse;

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
    expect(() => parse('.a { js: `1 + 1`; esc: ~`2 + 5 + "px"`; }', 'stylesheet')).toThrow(
      'Inline JavaScript using backticks is not supported. Use @use / @-use to import a script module instead. Script-module documentation is coming soon.'
    );
  });

  it('parses each() with a block callback into a For control node', () => {
    const { tree, errors } = parse(`
      .test {
        each(1 2 3 4, {
          padding+_: (@value * 10px);
        });
      }
    `, 'stylesheet');

    expect(errors.length).toBe(0);
    const ruleset = tree.value[0]!;
    const eachNode = ruleset.rules.value[0]!;
    expect(eachNode.type).toBe('For');
    expect(eachNode.pattern.kind).toBe('tuple');
    expect(eachNode.pattern.values.map((entry: any) => entry.name.valueOf())).toEqual(['value', 'key', 'index']);
    expect(eachNode.rules.value).toHaveLength(1);
  });

  it('preserves explicit each() callback params in the For pattern', () => {
    const { tree, errors } = parse(`
      each(a b, .(@v; @i) {
        x: @v @i;
      });
    `, 'declarationList');

    expect(errors.length).toBe(0);
    const eachNode = tree.value[0]!;
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
    expect(serialized).toContain('sep: \'/\'');
    expect(serialized).toContain('\'small\'');
    expect(serialized).toContain('(Dimension');
    expect(serialized).toContain('unit: \'px\'');
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
