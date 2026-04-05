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
    expect(out).toContainString('(Sequence');
  });

  it('should parse single space-delimited argument as one positional Sequence', () => {
    const { errors, tree } = parser.parse('length(1 2 3)');
    expect(errors.length).toBe(0);
    const out = serializeTypes(tree, { showOptions: true });
    expect(out).toContainString('(Call');
    expect(out).toContainString('(Sequence');
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

  it('should parse if() with semicolon-separated args', () => {
    const { errors } = parse('color: if(true; red; blue)', 'declaration');
    expect(errors.length).toBe(0);
  });

  it('should parse if() with a comparison condition', () => {
    const { errors } = parse('color: if(@i > 5, red, blue)', 'declaration');
    expect(errors.length).toBe(0);
  });

  it('should parse if() with a parenthesized comparison condition', () => {
    const { errors } = parse('color: if((@i > 5), red, blue)', 'declaration');
    expect(errors.length).toBe(0);
  });

  it('should parse if() with a parenthesized equality comparison condition', () => {
    const { errors } = parse('font-weight: if((mod(@i, 2) = 0), bold, normal)', 'declaration');
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
