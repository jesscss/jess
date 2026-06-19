import { serializeTypes } from '@jesscss/core';
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

  it('serializes comma-root mixin args as a comma List', () => {
    const { errors, tree } = parse('.mixin(a, b, c)', 'mixinOrQualifiedRule');
    expect(errors.length).toBe(0);
    const out = serializeTypes(tree, { showOptions: true });
    expect(out).toContainString('(Reference [role=name]');
    expect(out).toContainString('type: \'mixin-ruleset\'');
    expect(out).toContainString('key: \'.mixin\'');
    expect(out).toContainString('(List\n          sep: \',\'');
    expect(out).toContainString('items:');
    expect(out).toContainString('(Any [role=ident]');
    expect(out).toContainString('\'a\'');
    expect(out).toContainString('\'b\'');
    expect(out).toContainString('\'c\'');
  });

  it('serializes semicolon-root mixin args as a semicolon List', () => {
    const { errors, tree } = parse('.mixin(a; b; c)', 'mixinOrQualifiedRule');
    expect(errors.length).toBe(0);
    const out = serializeTypes(tree, { showOptions: true });
    expect(out).toContainString('(Reference [role=name]');
    expect(out).toContainString('type: \'mixin-ruleset\'');
    expect(out).toContainString('key: \'.mixin\'');
    expect(out).toContainString('(List\n          sep: \';\'');
    expect(out).toContainString('items:');
    expect(out).toContainString('(Any [role=ident]');
    expect(out).toContainString('\'a\'');
    expect(out).toContainString('\'b\'');
    expect(out).toContainString('\'c\'');
  });

  it('preserves escaped nested comma values inside semicolon-root mixin args', () => {
    const { errors, tree } = parse('.mixin(~(a, b); c)', 'mixinOrQualifiedRule');
    expect(errors.length).toBe(0);
    const out = serializeTypes(tree, { showOptions: true });
    expect(out).toContainString('(Reference [role=name]');
    expect(out).toContainString('key: \'.mixin\'');
    expect(out).toContainString('(List\n          sep: \';\'');
    expect(out).toContainString('(Paren\n              escaped: true');
    expect(out).toContainString('(Any [role=ident]');
    expect(out).toContainString('\'a\'');
    expect(out).toContainString('\'b\'');
    expect(out).toContainString('\'c\'');
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
    const { errors, tree } = parse('color: @var[key]', 'declaration');
    expect(errors.length).toBe(0);
    expect(serializeTypes(tree, { showOptions: true })).toContainString(`
      (Declaration
          assign: ':'
        name: 
          (Any [role=property]
              role: 'property'
            'color'
          )
        valueNode:
          (Reference
              type: 'index'
            target: 
              (Reference
                  type: 'variable'
                key: 'var'
              )
            key: 
              (Quoted
                  quote: '\\''
           value: 'key'
              )
          )
      `);
  });

  it('should preserve namespaced variable lookup shape', () => {
    const { errors, tree } = parse('color: #ns[@foo]', 'declaration');
    expect(errors.length).toBe(0);
    expect(serializeTypes(tree, { showOptions: true })).toContainString(`
      (Declaration
          assign: ':'
        name: 
          (Any [role=property]
              role: 'property'
            'color'
          )
        valueNode:
          (Reference
              type: 'variable'
            target: 
              (Reference [role=name]
                  type: 'mixin-ruleset'
                  role: 'name'
                key: '#ns'
              )
            key: 'foo'
          )
      `);
  });

  it('should parse call with parentheses', () => {
    const { errors, tree } = parse('color: .mixin()', 'declaration');
    expect(errors.length).toBe(0);
    expect(serializeTypes(tree, { showOptions: true })).toContainString(`
      (Declaration
          assign: ':'
        name: 
          (Any [role=property]
              role: 'property'
            'color'
          )
        valueNode:
          (Call
            name: 
              (Reference [role=name]
                  type: 'mixin-ruleset'
                  role: 'name'
                key: '.mixin'
              )
          )
      `);
  });

  it('should flatten compound segments in complex mixin reference paths', () => {
    const { errors, tree } = parse('#foo-foo > .bar.baz()', 'mixinOrQualifiedRule');
    expect(errors.length).toBe(0);
    expect(serializeTypes(tree, { showOptions: true })).toContainString(`
      (Call
          markImportant: false
        name: 
          (Reference [role=name]
              type: 'mixin-ruleset'
              role: 'name'
            key:
              ['#foo-foo', '.bar', '.baz']
            rawKey: 
              (ComplexSelector
      `);
  });
});
