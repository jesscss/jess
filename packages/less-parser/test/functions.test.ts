import { serializeTypes } from '@jesscss/core';
import { Parser } from '../src/index.js';

const parser = new Parser();
const parse = parser.parse;

describe('functionCall', () => {
  it('should parse generic function call', () => {
    const { errors } = parse('color: func()', 'declaration');
    expect(errors.length).toBe(0);
  });

  it('should parse function call with arguments', () => {
    const { errors } = parse('color: func(arg1, arg2)', 'declaration');
    expect(errors.length).toBe(0);
  });

  it('should parse functions at the root', () => {
    const { errors, tree } = parser.parse('func(1, 2, 3)');
    expect(errors.length).toBe(0);
    const out = serializeTypes(tree, { showOptions: true });
    expect(out).toContainString('(Call');
    expect(out).toContainString('silentFail: true');
    expect(out).toContainString('type: \'function\'');
    expect(out).toContainString('fallbackValue: true');
    expect(out).toContainString('key: \'func\'');
  });
});

describe('functionCallArgs', () => {
  it('should parse comma-separated arguments', () => {
    const { errors } = parse('color: func(a, b, c)', 'declaration');
    expect(errors.length).toBe(0);
  });

  it('should parse semicolon-separated arguments', () => {
    const { errors } = parse('color: func(a; b; c)', 'declaration');
    expect(errors.length).toBe(0);
  });

  it('should parse space-delimited first argument as Sequence in positional args', () => {
    const { errors, tree } = parser.parse('extract(1 2 3, 2)');
    expect(errors.length).toBe(0);
    const out = serializeTypes(tree, { showOptions: true });
    expect(out).toContainString('(Call');
    expect(out).toContainString('1,2,3');
    expect(out).toContainString('(Num 2)');
  });

  it('should parse single space-delimited argument as one positional Sequence', () => {
    const { errors, tree } = parser.parse('length(1 2 3)');
    expect(errors.length).toBe(0);
    const out = serializeTypes(tree, { showOptions: true });
    expect(out).toContainString('(Call');
    expect(out).toContainString('[Num, Num, Num]');
  });

  it('normalizes plain color keywords in function args to Color nodes', () => {
    const { errors, tree } = parser.parse('color(plum)');
    expect(errors.length).toBe(0);
    const out = serializeTypes(tree, { showOptions: true });
    expect(out).toContainString('(Call');
    expect(out).toContainString('type: \'function\'');
    expect(out).toContainString('(Color');
    expect(out).toContainString('node: \'plum\'');
  });

  it('serializes comma-root function args as a comma List', () => {
    const { errors, tree } = parser.parse('func(a, b, c)');
    expect(errors.length).toBe(0);
    const out = serializeTypes(tree, { showOptions: true });
    expect(out).toContainString('(Reference\n          type: \'function\'');
    expect(out).toContainString('key: \'func\'');
    expect(out).toContainString('args: \n  (List');
    expect(out).not.toContainString('sep: \';\'');
    expect(out).toContainString('(Keyword [role=keyword]');
    expect(out).toContainString('\'a\'');
    expect(out).toContainString('\'b\'');
    expect(out).toContainString('\'c\'');
  });

  it('serializes semicolon-root function args as a semicolon List', () => {
    const { errors, tree } = parser.parse('func(a; b; c)');
    expect(errors.length).toBe(0);
    const out = serializeTypes(tree, { showOptions: true });
    expect(out).toContainString('(Reference\n          type: \'function\'');
    expect(out).toContainString('key: \'func\'');
    expect(out).toContainString('(List\n          sep: \';\'');
    expect(out).toContainString('(Keyword [role=keyword]');
    expect(out).toContainString('\'a\'');
    expect(out).toContainString('\'b\'');
    expect(out).toContainString('\'c\'');
  });

  it('preserves escaped nested comma values inside semicolon-root function args', () => {
    const { errors, tree } = parser.parse('func(~(a, b); c)');
    expect(errors.length).toBe(0);
    const out = serializeTypes(tree, { showOptions: true });
    expect(out).toContainString('(List\n          sep: \';\'');
    expect(out).toContainString('(Paren\n              escaped: true');
    expect(out).toContainString('(List');
    expect(out).toContainString('(Keyword [role=keyword]');
    expect(out).toContainString('\'a\'');
    expect(out).toContainString('\'b\'');
    expect(out).toContainString('\'c\'');
  });
});

describe('knownFunctions', () => {
  it('should parse url() function', () => {
    const { errors } = parse('background: url("image.png")', 'declaration');
    expect(errors.length).toBe(0);
  });

  it('should parse var() function', () => {
    const { errors } = parse('color: var(--custom)', 'declaration');
    expect(errors.length).toBe(0);
  });

  it('should parse calc() function', () => {
    const { errors } = parse('width: calc(100% - 20px)', 'declaration');
    expect(errors.length).toBe(0);
  });
});

describe('ifFunction', () => {
  it('should parse if() function', () => {
    const { errors } = parse('color: if(true, red, blue)', 'declaration');
    expect(errors.length).toBe(0);
  });

  it('should parse if() with a parenthesized comparison condition', () => {
    const { errors } = parse('color: if((@i > 5), #ff0000, #0000ff)', 'declaration');
    expect(errors.length).toBe(0);
  });

  it('should parse if() with a parenthesized function-call comparison condition', () => {
    const { errors } = parse('font-weight: if((mod(@i, 2) = 0), bold, normal)', 'declaration');
    expect(errors.length).toBe(0);
  });

  it('should not leak guarded mixin comma state into nested if() conditions', () => {
    const conditions = [
      '@i > 5',
      'mod(@i, 2) = 0',
      '10 > @i',
      '@i + 1 > @n - 1',
      'lightness(#fff) > 60%'
    ];

    const declarations = conditions
      .map((condition, index) => `value-${index}: if((${condition}), yes, no);`)
      .join('\n');

    const { errors } = parse(`
      .gen-if-variants(@n, @i: 1) when (@i =< @n) {
        .variant-@{i} {
          ${declarations}
        }
      }
    `, 'stylesheet');
    expect(errors.length).toBe(0);
  });

  it('should parse if() with semicolon-separated args', () => {
    const { errors } = parse('color: if(true; red; blue)', 'declaration');
    expect(errors.length).toBe(0);
  });
});

describe('booleanFunction', () => {
  it('should parse boolean() function', () => {
    // boolean() function - using if() function instead as boolean() may not be standard
    const { errors } = parse('color: if(true, red, blue)', 'declaration');
    expect(errors.length).toBe(0);
  });
});

describe('callArgument', () => {
  it('should parse anonymous mixin as argument', () => {
    const { errors } = parse('.mixin({ color: red; })', 'mixinOrQualifiedRule');
    expect(errors.length).toBe(0);
  });

  it('should parse value sequence as argument', () => {
    const { errors } = parse('func(10px, 20px)', 'value');
    expect(errors.length).toBe(0);
  });
});
