import { parseLessAstStylesheet } from '../src/index.js';
import { N, isNode, serializeTypes } from '@jesscss/core';

describe('parseLessAstStylesheet', () => {
  test('returns a string-backed core Stylesheet for cheap Less declarations', () => {
    const result = parseLessAstStylesheet('inline.less', `
      @tone: red;
      @callish: rgb(10, 20, 30);

      .a {
        @local: 1px;
        color: @tone;
        background: blue !important; // ignored value comment
        --custom:  @local;
      }
    `);
    const [tone, callish, firstRule] = result.tree.rules;

    expect(result.diagnostics).toEqual([]);
    expect(isNode(tone, N.VarDeclaration)).toBe(true);
    expect(isNode(callish, N.VarDeclaration)).toBe(true);
    expect(isNode(firstRule, N.Ruleset)).toBe(true);
    if (!isNode(tone, N.VarDeclaration) || !isNode(callish, N.VarDeclaration) || !isNode(firstRule, N.Ruleset)) {
      throw new Error('Expected Less AST proof nodes');
    }

    expect(tone.name.valueOf()).toBe('tone');
    expect(tone.value).toBe('red');
    expect(callish.value).toBe('rgb(10, 20, 30)');
    expect(firstRule.selector).toBe('.a');

    const [local, color, background, custom] = firstRule.rules.rules;
    expect(isNode(local, N.VarDeclaration)).toBe(true);
    expect(isNode(color, N.Declaration)).toBe(true);
    expect(isNode(background, N.Declaration)).toBe(true);
    expect(isNode(custom, N.Declaration)).toBe(true);
    if (
      !isNode(local, N.VarDeclaration)
      || !isNode(color, N.Declaration)
      || !isNode(background, N.Declaration)
      || !isNode(custom, N.Declaration)
    ) {
      throw new Error('Expected Less declaration proof nodes');
    }

    expect(local.name.valueOf()).toBe('local');
    expect(local.value).toBe('1px');
    expect(color.name).toBe('color');
    expect(color.value).toBe('@tone');
    expect(background.important).toBe('!important');
    expect(custom.name).toBe('--custom');
    expect(custom.value).toBe('  @local');
    expect(firstRule.toTrimmedString()).toBe([
      '.a {',
      '  color: @tone;',
      '  background: blue !important;',
      '  --custom:  @local;',
      '}',
      ''
    ].join('\n'));
  });

  test('materializes cheap selector structure and keeps variable values unparsed', () => {
    const result = parseLessAstStylesheet('selectors.less', `
      @tone: red;
      #id.card { color: @tone; }
      .a > .b + div { width: @size; }
    `);
    const [, compoundRule, complexRule] = result.tree.rules;

    expect(result.diagnostics).toEqual([]);
    expect(isNode(compoundRule, N.Ruleset) && isNode(compoundRule.selector, N.CompoundSelector)).toBe(true);
    expect(isNode(complexRule, N.Ruleset) && isNode(complexRule.selector, N.ComplexSelector)).toBe(true);
    if (!isNode(compoundRule, N.Ruleset) || !isNode(compoundRule.selector, N.CompoundSelector)) {
      throw new Error('Expected string-backed compound selector');
    }
    if (!isNode(complexRule, N.Ruleset) || !isNode(complexRule.selector, N.ComplexSelector)) {
      throw new Error('Expected string-backed complex selector');
    }
    expect(compoundRule.selector.value).toEqual(['#id', '.card']);
    expect(complexRule.selector.value).toEqual(['.a', '>', '.b', '+', 'div']);
    expect(serializeTypes(compoundRule)).not.toContain('(BasicSelector');
    expect(serializeTypes(complexRule)).not.toContain('(Combinator');
    expect(serializeTypes(result.tree)).toContainString(`
          value: '@tone'
    `);
    expect(serializeTypes(result.tree)).toContainString(`
      (VarDeclaration
        name: 'tone'
        value: 'red'
      )
    `);
    expect(serializeTypes(result.tree)).not.toContain('(Any [role=ident]');
    expect(serializeTypes(result.tree)).not.toContain('(Reference');
  });

  test('parses nested Less rulesets without fallback parsing', () => {
    const result = parseLessAstStylesheet('nested.less', `
      .outer {
        color: red;
        .inner {
          width: @size;
          #id.card { color: blue; }
        }
        background: green;
      }
    `);
    const [outer] = result.tree.rules;

    expect(result.diagnostics).toEqual([]);
    expect(isNode(outer, N.Ruleset)).toBe(true);
    if (!isNode(outer, N.Ruleset)) {
      throw new Error('Expected outer ruleset');
    }

    const [color, inner, background] = outer.rules.rules;
    expect(isNode(color, N.Declaration)).toBe(true);
    expect(isNode(inner, N.Ruleset)).toBe(true);
    expect(isNode(background, N.Declaration)).toBe(true);
    if (!isNode(color, N.Declaration) || !isNode(inner, N.Ruleset) || !isNode(background, N.Declaration)) {
      throw new Error('Expected declarations around nested ruleset');
    }

    expect(inner.selector).toBe('.inner');
    const [width, compoundRule] = inner.rules.rules;
    expect(isNode(width, N.Declaration)).toBe(true);
    expect(isNode(compoundRule, N.Ruleset)).toBe(true);
    expect(width?.value).toBe('@size');
    expect(isNode(compoundRule, N.Ruleset) && isNode(compoundRule.selector, N.CompoundSelector)).toBe(true);
    if (!isNode(compoundRule, N.Ruleset) || !isNode(compoundRule.selector, N.CompoundSelector)) {
      throw new Error('Expected string-backed nested compound selector');
    }
    expect(compoundRule.selector.value).toEqual(['#id', '.card']);
    expect(serializeTypes(compoundRule)).not.toContain('(BasicSelector');
    expect(outer.toTrimmedString()).toBe([
      '.outer {',
      '  color: red;',
      '  .inner {',
      '    width: @size;',
      '    #id.card {',
      '      color: blue;',
      '    }',
      '  }',
      '  background: green;',
      '}',
      ''
    ].join('\n'));
  });

  test('parses plain ampersand blocks as scope Rules without selector materialization', () => {
    const result = parseLessAstStylesheet('ampersand-scope.less', `
      & {
        @tone: red;
        .inner { color: @tone; }
      }

      .outer {
        & {
          color: blue;
        }
        width: 1px;
      }
    `);
    const [rootScope, outer] = result.tree.rules;

    expect(result.diagnostics).toEqual([]);
    expect(isNode(rootScope, N.Rules)).toBe(true);
    expect(isNode(outer, N.Ruleset)).toBe(true);
    if (!isNode(rootScope, N.Rules) || !isNode(outer, N.Ruleset)) {
      throw new Error('Expected ampersand scope rules and outer ruleset');
    }

    expect(isNode(rootScope.rules[0], N.VarDeclaration)).toBe(true);
    expect(isNode(rootScope.rules[1], N.Ruleset)).toBe(true);
    const [nestedScope, width] = outer.rules.rules;
    expect(isNode(nestedScope, N.Rules)).toBe(true);
    expect(isNode(width, N.Declaration)).toBe(true);
    if (!isNode(nestedScope, N.Rules)) {
      throw new Error('Expected nested ampersand scope rules');
    }

    expect(nestedScope.toTrimmedString()).toBe('color: blue;');
    expect(outer.toTrimmedString()).toBe([
      '.outer {',
      '  color: blue;',
      '  width: 1px;',
      '}',
      ''
    ].join('\n'));
    expect(serializeTypes(result.tree)).not.toContain('(Ampersand');
    expect(serializeTypes(result.tree)).not.toContain('selector: \'&\'');
  });

  test('parses parameterless Less mixin definitions without fallback parsing', () => {
    const result = parseLessAstStylesheet('mixin-definition.less', `
      .paint() {
        color: red;
        .nested { width: @size; }
      }

      #theme() {
        background: blue;
      }
    `);
    const [paint, theme] = result.tree.rules;

    expect(result.diagnostics).toEqual([]);
    expect(isNode(paint, N.Mixin)).toBe(true);
    expect(isNode(theme, N.Mixin)).toBe(true);
    if (!isNode(paint, N.Mixin) || !isNode(theme, N.Mixin)) {
      throw new Error('Expected parameterless Less mixin definitions');
    }
    expect(paint.name?.valueOf()).toBe('.paint');
    expect(paint.params).toBeUndefined();
    expect(paint.rules.rules[0]?.toTrimmedString()).toBe('color: red');
    expect(paint.rules.rules[1]?.toTrimmedString()).toBe([
      '.nested {',
      '  width: @size;',
      '}',
      ''
    ].join('\n'));
    expect(theme.name?.valueOf()).toBe('#theme');
    expect(theme.rules.rules[0]?.toTrimmedString()).toBe('background: blue');
    expect(serializeTypes(result.tree)).toContainString(`
      (Mixin
        name: (Any [role=name] '.paint')
    `);
  });

  test('parses cheap Less mixin definition parameters without fallback parsing', () => {
    const result = parseLessAstStylesheet('mixin-params.less', `
      .paint(@tone; @size) {
        color: @tone;
        width: @size;
      }

      #theme(@mode, @contrast) {
        color: @mode;
      }

      .trail(@tone;) {
        color: @tone;
      }
    `);
    const [paint, theme, trail] = result.tree.rules;

    expect(result.diagnostics).toEqual([]);
    expect(isNode(paint, N.Mixin)).toBe(true);
    expect(isNode(theme, N.Mixin)).toBe(true);
    expect(isNode(trail, N.Mixin)).toBe(true);
    if (!isNode(paint, N.Mixin) || !isNode(theme, N.Mixin) || !isNode(trail, N.Mixin)) {
      throw new Error('Expected parameterized Less mixin definition');
    }
    expect(paint.name?.valueOf()).toBe('.paint');
    expect(isNode(paint.params, N.List)).toBe(true);
    expect(paint.params?.sep).toBe(';');
    expect(paint.params?.items.map(item => item.toTrimmedString())).toEqual(['$tone', '$size']);
    expect(serializeTypes(paint)).toContainString(`
        params:
          (List
            items:
              [
                (VarDeclaration
                  name:
                    (Any [role=property] 'tone')
                  value:
                    (Nil '')
                )
                (VarDeclaration
                  name:
                    (Any [role=property] 'size')
                  value:
                    (Nil '')
                )
              ]
          )
    `);
    expect(theme.name?.valueOf()).toBe('#theme');
    expect(theme.params?.sep).toBe(',');
    expect(theme.params?.items.map(item => item.toTrimmedString())).toEqual(['$mode', '$contrast']);
    expect(trail.params?.sep).toBe(';');
    expect(trail.params?.items.map(item => item.toTrimmedString())).toEqual(['$tone']);
  });

  test('keeps unsupported Less mixin parameter forms out of the cheap AST path', () => {
    const result = parseLessAstStylesheet('unsupported-mixin-params.less', `
      .badDefault(@tone: red) { color: @tone; }
      .badRest(@args...) { color: red; }
      .badMixed(@a; @b, @c) { color: @a; }
      .badGuard(@a) when (@enabled) { color: @a; }
      .1(@a) { color: red; }
      .-(@a) { color: red; }
    `);

    expect(result.tree.rules).toEqual([]);
    expect(result.diagnostics.map(diagnostic => diagnostic.code)).toEqual([
      'less-ast-unsupported-block-header',
      'less-ast-unsupported-block-header',
      'less-ast-unsupported-block-header',
      'less-ast-unsupported-block-header',
      'less-ast-unsupported-block-header',
      'less-ast-unsupported-block-header'
    ]);
  });

  test('parses parameterless Less mixin calls without fallback parsing', () => {
    const result = parseLessAstStylesheet('mixin-calls.less', `
      .paint();
      #theme() !important;

      .a {
        .nested();
      }
    `);
    const [paint, theme, rule] = result.tree.rules;

    expect(result.diagnostics).toEqual([]);
    expect(isNode(paint, N.Call)).toBe(true);
    expect(isNode(theme, N.Call)).toBe(true);
    expect(isNode(rule, N.Ruleset)).toBe(true);
    if (!isNode(paint, N.Call) || !isNode(theme, N.Call) || !isNode(rule, N.Ruleset)) {
      throw new Error('Expected parameterless Less mixin calls');
    }
    expect(isNode(paint.name, N.Reference)).toBe(true);
    expect(isNode(theme.name, N.Reference)).toBe(true);
    if (!isNode(paint.name, N.Reference) || !isNode(theme.name, N.Reference)) {
      throw new Error('Expected Less mixin call references');
    }
    expect(paint.name.key).toBe('.paint');
    expect(paint.name.options.type).toBe('mixin-ruleset');
    expect(paint.name.options.role).toBe('name');
    expect(paint.args).toBeUndefined();
    expect(theme.name.key).toBe('#theme');
    expect(theme.name.options.type).toBe('mixin-ruleset');
    expect(theme.name.options.role).toBe('name');
    expect(theme.options.markImportant).toBe(true);

    const [nested] = rule.rules.rules;
    expect(isNode(nested, N.Call)).toBe(true);
    if (!isNode(nested, N.Call) || !isNode(nested.name, N.Reference)) {
      throw new Error('Expected nested parameterless mixin call');
    }
    expect(nested.name.key).toBe('.nested');
    expect(serializeTypes(result.tree)).toContainString(`
      (Call
        name:
          (Reference [role=name]
            key: '.paint'
          )
      )
    `);
  });

  test('parses argument-bearing Less mixin calls without fallback parsing', () => {
    const result = parseLessAstStylesheet('mixin-calls-with-args.less', `
      .withArgs(@tone, 2px);
      #theme(red; screen and (min-width: 1px)) !important;

      .a {
        .nested(rgb(10, 20, 30), "{");
      }
    `);
    const [withArgs, theme, rule] = result.tree.rules;

    expect(result.diagnostics).toEqual([]);
    expect(isNode(withArgs, N.Call)).toBe(true);
    expect(isNode(theme, N.Call)).toBe(true);
    expect(isNode(rule, N.Ruleset)).toBe(true);
    if (!isNode(withArgs, N.Call) || !isNode(theme, N.Call) || !isNode(rule, N.Ruleset)) {
      throw new Error('Expected argument-bearing Less mixin calls');
    }
    expect(isNode(withArgs.args, N.List)).toBe(true);
    expect(isNode(theme.args, N.List)).toBe(true);
    if (!isNode(withArgs.args, N.List) || !isNode(theme.args, N.List)) {
      throw new Error('Expected Less mixin call argument lists');
    }
    expect(withArgs.args.sep).toBe(',');
    expect(withArgs.args.items.map(item => item.valueOf())).toEqual(['@tone', '2px']);
    expect(theme.args.sep).toBe(';');
    expect(theme.args.items.map(item => item.valueOf())).toEqual(['red', 'screen and (min-width: 1px)']);
    expect(theme.options.markImportant).toBe(true);

    const [nested] = rule.rules.rules;
    expect(isNode(nested, N.Call)).toBe(true);
    if (!isNode(nested, N.Call) || !isNode(nested.args, N.List)) {
      throw new Error('Expected nested argument-bearing mixin call');
    }
    expect(nested.args.items.map(item => item.valueOf())).toEqual(['rgb(10, 20, 30)', '"{"']);
    expect(serializeTypes(result.tree)).toContainString(`
      (Call
        name:
          (Reference [role=name]
            key: '.withArgs'
          )
        args:
          (List
            items:
              [
                (Any '@tone')
                (Any '2px')
              ]
          )
      )
    `);
  });

  test('keeps unsupported Less mixin call forms out of the cheap AST path', () => {
    const result = parseLessAstStylesheet('unsupported-mixin-calls.less', `
      .empty(,);
      .suffix(a) b;
      .mixed(a, b; c);
      .named(@tone: red);
      .rest(@items...);
      .bad([oops)]);
      .deprecated;
      .1();
      .-();
    `);

    expect(result.tree.rules).toEqual([]);
    expect(result.diagnostics.map(diagnostic => diagnostic.code)).toEqual([
      'less-ast-unsupported-statement',
      'less-ast-unsupported-statement',
      'less-ast-unsupported-statement',
      'less-ast-unsupported-statement',
      'less-ast-unsupported-statement',
      'less-ast-unsupported-statement',
      'less-ast-unsupported-statement',
      'less-ast-unsupported-statement',
      'less-ast-unsupported-statement'
    ]);
  });

  test('diagnoses malformed Less at-rule blocks without fallback parsing', () => {
    const result = parseLessAstStylesheet('unsupported.less', `
      @ {
        .inside { color: red; }
      }

      .outer {
        .nested { color: blue; }
      }

      .kept {
        color: green;
      }
    `);

    expect(result.diagnostics.map(diagnostic => diagnostic.code)).toEqual([
      'less-ast-unsupported-at-rule'
    ]);
    expect(result.tree.rules).toHaveLength(2);
    expect(result.tree.rules[0]?.toTrimmedString()).toBe([
      '.outer {',
      '  .nested {',
      '    color: blue;',
      '  }',
      '}',
      ''
    ].join('\n'));
    expect(result.tree.rules[1]?.toTrimmedString()).toBe([
      '.kept {',
      '  color: green;',
      '}',
      ''
    ].join('\n'));
  });

  test('parses cheap block at-rules with string-backed headers', () => {
    const result = parseLessAstStylesheet('at-rule.less', `
      @media screen {
        .inside { color: red; }
      }
    `);
    const [media] = result.tree.rules;

    expect(result.diagnostics).toEqual([]);
    expect(isNode(media, N.AtRule)).toBe(true);
    if (!isNode(media, N.AtRule)) {
      throw new Error('Expected string-backed AtRule');
    }
    expect(media.name).toBe('@media');
    expect(media.prelude).toBe('screen');
    expect(media.toTrimmedString()).toBe([
      '@media screen {',
      '  .inside {',
      '    color: red;',
      '  }',
      '}',
      ''
    ].join('\n'));
    expect(serializeTypes(media)).toContainString(`
      (AtRule
        name: '@media'
        prelude: 'screen'
    `);
    expect(serializeTypes(media)).not.toContain('(Any [role=atkeyword]');
  });

  test('parses balanced block at-rule preludes into query-ready nodes', () => {
    const result = parseLessAstStylesheet('media-query.less', `
      @media screen and (min-width: 1px) {
        .inside { color: red; }
      }
    `);
    const [media] = result.tree.rules;

    expect(result.diagnostics).toEqual([]);
    expect(isNode(media, N.AtRule)).toBe(true);
    if (!isNode(media, N.AtRule)) {
      throw new Error('Expected query-backed AtRule');
    }
    expect(typeof media.prelude).not.toBe('string');
    expect(media.prelude?.toTrimmedString()).toBe('screen and (min-width: 1px)');
    expect(media.toTrimmedString()).toBe([
      '@media screen and (min-width: 1px) {',
      '  .inside {',
      '    color: red;',
      '  }',
      '}',
      ''
    ].join('\n'));
    expect(serializeTypes(media)).toContainString(`
        prelude:
          (QueryCondition
            items:
              [
                (Any 'screen')
                (Any 'and')
                (Paren
                  node:
                    (Any 'min-width: 1px')
    `);
  });

  test('diagnoses unsupported structured at-rule preludes instead of widening raw strings', () => {
    const result = parseLessAstStylesheet('unsupported-media.less', `
      @media screen and (foo, bar) {
        .comma { color: red; }
      }

      @media (@{bp}) {
        .interpolated { color: blue; }
      }
    `);

    expect(result.tree.rules).toEqual([]);
    expect(result.diagnostics.map(diagnostic => diagnostic.code)).toEqual([
      'less-ast-unsupported-at-rule',
      'less-ast-unsupported-at-rule'
    ]);
  });

  test('diagnoses unsupported Less block headers instead of creating raw selector rulesets', () => {
    const result = parseLessAstStylesheet('unsupported-block.less', `
      .mixin(@x: red) { color: @x; }
      .a {
        .b when (@enabled) { color: blue; }
        color: red;
      }
    `);
    const [rule] = result.tree.rules;

    expect(result.diagnostics.map(diagnostic => diagnostic.code)).toEqual([
      'less-ast-unsupported-block-header',
      'less-ast-unsupported-block-header'
    ]);
    expect(result.tree.rules).toHaveLength(1);
    expect(rule?.toTrimmedString()).toBe([
      '.a {',
      '  color: red;',
      '}',
      ''
    ].join('\n'));
    expect(serializeTypes(result.tree)).not.toContain('.mixin(@x)');
    expect(serializeTypes(result.tree)).not.toContain('when (@enabled)');
  });

  test('parses detached ruleset variable values as string-backed mixins', () => {
    const result = parseLessAstStylesheet('detached-ruleset.less', `
      @ruleset: {
        color: black;
        .nested { width: @size; }
      };
    `);
    const [rulesetVariable] = result.tree.rules;

    expect(result.diagnostics).toEqual([]);
    expect(isNode(rulesetVariable, N.VarDeclaration)).toBe(true);
    if (!isNode(rulesetVariable, N.VarDeclaration) || !isNode(rulesetVariable.value, N.Mixin)) {
      throw new Error('Expected detached ruleset variable with anonymous mixin value');
    }
    expect(rulesetVariable.value.rules.options.rulesVisibility).toEqual({
      Declaration: 'public',
      Mixin: 'private',
      Ruleset: 'public',
      VarDeclaration: 'private'
    });
    expect(serializeTypes(rulesetVariable)).toContainString(`
      (VarDeclaration
        name: 'ruleset'
        value:
          (Mixin
            rules:
              (Rules
                rules:
                  [
                    (Declaration
                      name: 'color'
                      value: 'black'
                    )
                    (Ruleset
                      selector: '.nested'
                      rules:
                        (Rules
                          rules:
                            [
                              (Declaration
                                name: 'width'
                                value: '@size'
                              )
                            ]
                        )
                    )
                  ]
              )
          )
      )
    `);
  });

  test('diagnoses empty declaration names inside rulesets', () => {
    const result = parseLessAstStylesheet('empty-name.less', '.a { : red; color: green; }');
    const [rule] = result.tree.rules;

    expect(result.diagnostics.map(diagnostic => diagnostic.code)).toEqual([
      'less-ast-empty-declaration-name'
    ]);
    expect(isNode(rule, N.Ruleset) && rule.rules.rules).toHaveLength(1);
    expect(rule?.toTrimmedString()).toBe([
      '.a {',
      '  color: green;',
      '}',
      ''
    ].join('\n'));
  });
});
