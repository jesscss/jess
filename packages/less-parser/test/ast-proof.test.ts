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
      .mixin(@x) { color: @x; }
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
