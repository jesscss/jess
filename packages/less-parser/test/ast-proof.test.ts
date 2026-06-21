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
    expect(serializeTypes(compoundRule)).toContainString(`
      selector:
        (CompoundSelector
          value:
            [
              (BasicSelector '#id')
              (BasicSelector '.card')
            ]
        )
    `);
    expect(serializeTypes(complexRule)).toContainString(`
      selector:
        (ComplexSelector
          value:
            [
              (BasicSelector '.a')
              (Combinator '>')
              (BasicSelector '.b')
              (Combinator '+')
              (BasicSelector 'div')
            ]
        )
    `);
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
    expect(serializeTypes(compoundRule)).toContainString(`
      selector:
        (CompoundSelector
          value:
            [
              (BasicSelector '#id')
              (BasicSelector '.card')
            ]
        )
    `);
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

  test('diagnoses unsupported Less at-rule blocks without fallback parsing', () => {
    const result = parseLessAstStylesheet('unsupported.less', `
      @media (min-width: 1px) {
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
