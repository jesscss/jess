import { Parser } from '../src/index.js';

const parser = new Parser();
const parse = parser.parse;

describe('anonymousMixinDefinition', () => {
  it('should parse anonymous mixin', () => {
    const { errors } = parse('.(@v;@i) {}', 'anonymousMixinDefinition');
    expect(errors.length).toBe(0);
  });

  it('should parse anonymous mixin without params', () => {
    const { errors } = parse('.() {}', 'anonymousMixinDefinition');
    expect(errors.length).toBe(0);
  });
});

describe('mixinArgs', () => {
  it('should parse mixin args', () => {
    const { errors } = parse('(@v)', 'mixinArgs', { isDefinition: true });
    expect(errors.length).toBe(0);
  });

  it('should parse empty mixin args', () => {
    const { errors } = parse('()', 'mixinArgs');
    expect(errors.length).toBe(0);
  });
});

describe('mixinArgList', () => {
  it('should parse comma-separated mixin args', () => {
    const { errors } = parse('(@a, @b)', 'mixinArgs');
    expect(errors.length).toBe(0);
  });

  it('should parse semicolon-separated mixin args', () => {
    const { errors } = parse('(@a; @b)', 'mixinArgs');
    expect(errors.length).toBe(0);
  });
});

describe('mixinArg', () => {
  it('should parse mixin arg with default value', () => {
    const { errors } = parse('(@a: 10px)', 'mixinArgs');
    expect(errors.length).toBe(0);
  });

  it('should parse rest parameter', () => {
    const { errors } = parse('(@rest...)', 'mixinArgs', { isDefinition: true });
    expect(errors.length).toBe(0);
  });
});

describe('mixinName', () => {
  it('should parse class mixin name', () => {
    const { errors } = parse('.mixin() { }', 'mixinOrQualifiedRule');
    expect(errors.length).toBe(0);
  });

  it('should parse id mixin name', () => {
    const { errors } = parse('#mixin() { }', 'mixinOrQualifiedRule');
    expect(errors.length).toBe(0);
  });
});

describe('mixinOrQualifiedRule', () => {
  it('should parse mixin definition', () => {
    const { errors } = parse('.m(@v) when (@v) {two: when true}', 'mixinOrQualifiedRule');
    expect(errors.length).toBe(0);
  });

  it('should parse mixin call variants', () => {
    let { errors } = parse('.mixin-with-guard-inside(0px)', 'mixinOrQualifiedRule');
    expect(errors.length).toBe(0);

    ({ errors } = parse(`.mixin;`, 'main'));
    expect(errors.length).toBe(0);

    ({ errors } = parse(`.wrap-mixin(@ruleset: { color: red; })`, 'mixinOrQualifiedRule'));
    expect(errors.length).toBe(0);

    ({ errors } = parse('.mixin-takes-two(@a : d, e; @b : f)', 'mixinOrQualifiedRule'));
    expect(errors.length).toBe(0);

    ({ errors } = parse('.mixin-call({direct: works;}; @b: {named: works;});', 'stylesheet'));
    expect(errors.length).toBe(0);

    ({ errors } = parse(`.mixout ('left') { }`, 'mixinOrQualifiedRule'));
    expect(errors.length).toBe(0);
  });
});

describe('mixinReference', () => {
  it('should parse mixin reference', () => {
    const { errors } = parse('color: .mixin', 'declaration');
    expect(errors.length).toBe(0);
  });

  it('should parse chained mixin reference', () => {
    const { errors } = parse('color: .mixin > .nested', 'declaration');
    expect(errors.length).toBe(0);
  });
});

describe('lookupOrCall', () => {
  it('should parse lookup with brackets', () => {
    const { errors } = parse('color: @var[key]', 'declaration');
    expect(errors.length).toBe(0);
  });

  it('should parse call with parentheses', () => {
    const { errors } = parse('color: .mixin()', 'declaration');
    expect(errors.length).toBe(0);
  });
});

