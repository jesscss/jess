import { serializeTypes, type Node } from '@jesscss/core';
import { Parser } from '../src/jess.js';

const parser = new Parser();
const parse = parser.parse;

describe('function/mixin argument unification', () => {
  it('function calls accept spreads and named args (a .jess extension)', () => {
    for (const src of ['.a { x: foo(@args...); }', '.a { x: foo(@k: 1, red); }', '.a { x: foo(a; b, c); }']) {
      expect(parse(src).errors.length).toBe(0);
    }
  });

  it('function calls reject the illegal ,/; mix, same as mixin calls', () => {
    const { errors } = parse('.a { x: foo(@a: 1; @b: 2, @c: 3); }');
    expect(errors.length).toBe(1);
    expect(String(errors[0]!.message ?? errors[0])).toContain('Cannot mix ; and ,');
  });
});

function namedNode(n: Node | string | undefined): { name: { rawKey?: { type: string; toString(): string } } } {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return n as unknown as { name: { rawKey?: { type: string; toString(): string } } };
}

describe('anonymousMixinDefinition', () => {
  it('should parse anonymous mixin', () => {
    const { errors } = parse('.(@v;@i) {}', 'AnonymousMixinDefinition');
    expect(errors.length).toBe(0);
  });

  it('should parse anonymous mixin without params', () => {
    const { errors } = parse('.() {}', 'AnonymousMixinDefinition');
    expect(errors.length).toBe(0);
  });
});

describe('mixinArgs', () => {
  it('should parse mixin args', () => {
    // @ts-expect-error -- the bound parse() collapses its overloads, hiding the optional third (rule-options) argument this start rule accepts at runtime.
    const { errors } = parser.parse('(@v)', 'MixinArgs', { isDefinition: true });
    expect(errors.length).toBe(0);
  });

  it('should parse empty mixin args', () => {
    const { errors } = parse('()', 'MixinArgs');
    expect(errors.length).toBe(0);
  });
});

describe('mixinArgList', () => {
  it('should parse comma-separated mixin args', () => {
    const { errors } = parse('(@a, @b)', 'MixinArgs');
    expect(errors.length).toBe(0);
  });

  it('should parse semicolon-separated mixin args', () => {
    const { errors } = parse('(@a; @b)', 'MixinArgs');
    expect(errors.length).toBe(0);
  });

  it('serializes comma-root mixin args as a comma List', () => {
    const { errors, tree } = parse('.mixin(a, b, c)', 'MixinOrQualifiedRule');
    expect(errors.length).toBe(0);
    const out = serializeTypes(tree, { showOptions: true });
    expect(out).toContainString('(Reference [role=name]');
    expect(out).toContainString('type: \'mixin-ruleset\'');
    expect(out).toContainString('key: \'.mixin\'');
    // Comma args serialize as a plain List (default separator) — identical to
    // function-call args; only semicolon args carry an explicit `sep: ';'`.
    expect(out).toContainString('args:');
    expect(out).toContainString('(List');
    expect(out).toContainString('value:');
    expect(out).toContainString('(Keyword [role=keyword]');
    expect(out).toContainString('\'a\'');
    expect(out).toContainString('\'b\'');
    expect(out).toContainString('\'c\'');
  });

  // Less `;`-separated mixin args are LOWERED to the unified Jess representation:
  // args comma-separated, any comma-list arg wrapped in `~(…)` (escaped Paren). So
  // Less `;` and Jess `~(…)` produce the same AST (deferred-task-1 lowering).
  it('lowers semicolon mixin args with SCALAR groups to a plain comma List', () => {
    // `a; b; c` — each `;`-group is a scalar, so no comma-list to wrap: the outer
    // List is just comma-separated (no `sep: ';'`, no Parens).
    const { errors, tree } = parse('.mixin(a; b; c)', 'MixinOrQualifiedRule');
    expect(errors.length).toBe(0);
    const out = serializeTypes(tree, { showOptions: true });
    expect(out).toContainString('(Reference [role=name]');
    expect(out).toContainString('type: \'mixin-ruleset\'');
    expect(out).toContainString('key: \'.mixin\'');
    expect(out).not.toContainString('sep: \';\'');
    expect(out).not.toContainString('(Paren');
    expect(out).toContainString('(Keyword [role=keyword]');
    expect(out).toContainString('\'a\'');
    expect(out).toContainString('\'b\'');
    expect(out).toContainString('\'c\'');
  });

  it('lowers a comma-list mixin arg to an escaped Paren (`~(…)`)', () => {
    // `.mixin(a, b; c)` — the first `;`-group is a comma-list, so it becomes an
    // escaped Paren `~(a, b)`; `c` stays a scalar. Same AST as Jess `mixin(~(a, b), c)`.
    const { errors, tree } = parse('.mixin(a, b; c)', 'MixinOrQualifiedRule');
    expect(errors.length).toBe(0);
    const out = serializeTypes(tree, { showOptions: true });
    expect(out).toContainString('(Reference [role=name]');
    expect(out).toContainString('key: \'.mixin\'');
    expect(out).not.toContainString('sep: \';\'');
    expect(out).toContainString('(Paren\n              escaped: true');
    expect(out).toContainString('(Keyword [role=keyword]');
    expect(out).toContainString('\'a\'');
    expect(out).toContainString('\'b\'');
    expect(out).toContainString('\'c\'');
  });

  it('an authored `~(…)` mixin arg round-trips to the same escaped Paren', () => {
    // Less `~(a, b)` (authored escape) and the lowered `;`-arg converge on one AST.
    const { errors, tree } = parse('.mixin(~(a, b); c)', 'MixinOrQualifiedRule');
    expect(errors.length).toBe(0);
    const out = serializeTypes(tree, { showOptions: true });
    expect(out).not.toContainString('sep: \';\'');
    expect(out).toContainString('(Paren\n              escaped: true');
    expect(out).toContainString('\'a\'');
    expect(out).toContainString('\'b\'');
    expect(out).toContainString('\'c\'');
  });
});

describe('mixinArg', () => {
  it('should parse mixin arg with default value', () => {
    const { errors } = parse('(@a: 10px)', 'MixinArgs');
    expect(errors.length).toBe(0);
  });

  it('should parse rest parameter', () => {
    // @ts-expect-error -- the bound parse() collapses its overloads, hiding the optional third (rule-options) argument this start rule accepts at runtime.
    const { errors } = parser.parse('(@rest...)', 'MixinArgs', { isDefinition: true });
    expect(errors.length).toBe(0);
  });

  it('parses variadic params as Rest nodes (named and bare)', () => {
    // Both `@rest...` and a bare `...` must be Rest nodes — not a `...` Keyword,
    // which would make a variadic mixin fail to match any call.
    for (const src of ['(@rest...)', '(...)']) {
      const { errors, tree } = parse(src, 'MixinArgs');
      expect(errors.length).toBe(0);
      expect(serializeTypes(tree, { showOptions: true })).toContainString('(Rest');
    }
  });

  it('parses an arithmetic mixin-call argument as an Operation, not a raw Reference', () => {
    // Regression: mixin-call args were captured as opaque text, so a `@`-leading
    // chunk became a single Reference whose key was the raw expression string.
    const { errors, tree } = parse('.m(0, @a * 2 + @b)', 'MixinOrQualifiedRule');
    expect(errors.length).toBe(0);
    const out = serializeTypes(tree, { showOptions: true });
    // The expression must be a real Operation over References to @a and @b …
    expect(out).toContainString('(Operation');
    // … and must NOT collapse into a single Reference whose key is the raw text.
    expect(out).not.toContainString('\'a * 2 + @b\'');
    expect(out).not.toContainString('\'a * 2\'');
  });
});

describe('mixinName', () => {
  it('should parse class mixin name', () => {
    const { errors } = parse('.mixin() { }', 'MixinOrQualifiedRule');
    expect(errors.length).toBe(0);
  });

  it('should parse id mixin name', () => {
    const { errors } = parse('#mixin() { }', 'MixinOrQualifiedRule');
    expect(errors.length).toBe(0);
  });
});

describe('mixinOrQualifiedRule', () => {
  it('should parse mixin definition', () => {
    const { errors } = parse('.m(@v) when (@v) {two: when true}', 'MixinOrQualifiedRule');
    expect(errors.length).toBe(0);
  });

  it('should parse mixin call variants', () => {
    let { errors } = parse('.mixin-with-guard-inside(0px)', 'MixinOrQualifiedRule');
    expect(errors.length).toBe(0);

    ({ errors } = parse(`.mixin;`, 'Stylesheet'));
    expect(errors.length).toBe(0);

    ({ errors } = parse(`.wrap-mixin(@ruleset: { color: red; })`, 'MixinOrQualifiedRule'));
    expect(errors.length).toBe(0);

    ({ errors } = parse('.mixin-takes-two(@a : d, e; @b : f)', 'MixinOrQualifiedRule'));
    expect(errors.length).toBe(0);

    ({ errors } = parse('.mixin-call({direct: works;}; @b: {named: works;});', 'Stylesheet'));
    expect(errors.length).toBe(0);

    ({ errors } = parse(`.mixout ('left') { }`, 'MixinOrQualifiedRule'));
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
        name: 'color'
        value:
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
        name: 'color'
        value:
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
        name: 'color'
        value:
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
    const { errors, tree } = parse('#foo-foo > .bar.baz()', 'MixinOrQualifiedRule');
    expect(errors.length).toBe(0);
    const out = serializeTypes(tree, { showOptions: true });
    expect(out).toContainString('markImportant: false');
    expect(out).toContainString('(Reference [role=name]');
    expect(out).toContainString('type: \'mixin-ruleset\'');
    expect(out).toContainString('role: \'name\'');
    expect(out).toContainString('key:\n        [\'#foo-foo\', \'.bar\', \'.baz\']');
    expect(namedNode(tree).name.rawKey?.type).toBe('ComplexSelector');
    expect(namedNode(tree).name.rawKey?.toString()).toBe('#foo-foo > .bar.baz');
  });
});
