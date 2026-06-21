import { parseFlatLessDeclarationStylesheet } from '../src/index.js';
import { N, isNode, serializeTypes } from '@jesscss/core';

describe('parseFlatLessDeclarationStylesheet', () => {
  test('returns a string-backed core Stylesheet for cheap Less declarations', () => {
    const result = parseFlatLessDeclarationStylesheet('inline.less', `
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
      throw new Error('Expected flat Less AST proof nodes');
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
      throw new Error('Expected flat Less declaration proof nodes');
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
    const result = parseFlatLessDeclarationStylesheet('selectors.less', `
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

  test('diagnoses unsupported Less blocks without fallback parsing', () => {
    const result = parseFlatLessDeclarationStylesheet('unsupported.less', `
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
      'less-flat-unsupported-at-rule',
      'less-flat-unsupported-nested-block'
    ]);
    expect(result.tree.rules).toHaveLength(1);
    expect(result.tree.rules[0]?.toTrimmedString()).toBe([
      '.kept {',
      '  color: green;',
      '}',
      ''
    ].join('\n'));
  });

  test('diagnoses empty declaration names inside rulesets', () => {
    const result = parseFlatLessDeclarationStylesheet('empty-name.less', '.a { : red; color: green; }');
    const [rule] = result.tree.rules;

    expect(result.diagnostics.map(diagnostic => diagnostic.code)).toEqual([
      'less-flat-empty-declaration-name'
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
