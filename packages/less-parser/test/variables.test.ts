import { Parser } from '../src';

const parser = new Parser();
const parse = parser.parse;

describe('varDeclarationOrCall', () => {
  it('should parse variable declaration', () => {
    const { errors } = parse('@a: 1px;', 'stylesheet');
    expect(errors.length).toBe(0);
  });

  it('should parse variable declaration with mixin value', () => {
    const { errors } = parse('@ruleset: { color: black; background: white; }', 'stylesheet');
    expect(errors.length).toBe(0);
  });

  it('should parse variable call', () => {
    const { errors } = parse('@var();', 'main');
    expect(errors.length).toBe(0);
  });
});

describe('varReference', () => {
  it('should parse variable reference', () => {
    const { errors } = parse('color: @var', 'declaration');
    expect(errors.length).toBe(0);
  });

  it('should parse nested variable reference', () => {
    const { errors } = parse('color: @@var', 'declaration');
    expect(errors.length).toBe(0);
  });
});

describe('valueReference', () => {
  it('should parse value reference (variable or mixin)', () => {
    const { errors } = parse('color: .mixin', 'declaration');
    expect(errors.length).toBe(0);
  });

  it('should parse value reference as variable', () => {
    const { errors } = parse('color: @var', 'declaration');
    expect(errors.length).toBe(0);
  });
});

describe('varName', () => {
  it('should parse variable name', () => {
    const { errors } = parse('@var: value;', 'stylesheet');
    expect(errors.length).toBe(0);
  });
});

