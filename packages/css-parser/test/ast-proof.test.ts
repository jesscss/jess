import { parseFlatCssDeclarationStylesheet } from '../src/index.js';
import { N, isNode, serializeTypes } from '@jesscss/core';
import { SourceText } from '@jesscss/parser';

describe('parseFlatCssDeclarationStylesheet', () => {
  test('returns a string-backed core Stylesheet for cheap qualified rules', () => {
    const result = parseFlatCssDeclarationStylesheet('inline.css', `
      .a {
        color: red;
        background: blue !important;
        --gap:  1px 2px;
      }
    `);
    const { tree: root } = result;

    expect(result.diagnostics).toEqual([]);
    expect(result.source.filePath).toBe('inline.css');
    expect(root.type).toBe('Stylesheet');
    expect(isNode(root, N.Rules)).toBe(true);

    const firstRule = root.rules[0];
    expect(isNode(firstRule, N.Ruleset)).toBe(true);
    if (!isNode(firstRule, N.Ruleset)) {
      throw new Error('Expected a ruleset');
    }

    expect(firstRule.selector).toBe('.a');
    const [color, background, custom] = firstRule.rules.rules;
    expect(isNode(color, N.Declaration)).toBe(true);
    expect(isNode(background, N.Declaration)).toBe(true);
    expect(isNode(custom, N.Declaration)).toBe(true);
    if (!isNode(color, N.Declaration) || !isNode(background, N.Declaration) || !isNode(custom, N.Declaration)) {
      throw new Error('Expected declarations');
    }

    expect(color.name).toBe('color');
    expect(color.value).toBe('red');
    expect(background.important).toBe('!important');
    expect(custom.name).toBe('--gap');
    expect(custom.value).toBe('  1px 2px');
    expect(root.toTrimmedString()).toBe([
      '.a {',
      '  color: red;',
      '  background: blue !important;',
      '  --gap:  1px 2px;',
      '}',
      ''
    ].join('\n'));
  });

  test('reuses caller-owned source text and recovers after at-rule statements', () => {
    const source = new SourceText('@import "x.css";\n.kept { color: green; }', 'reuse.css', 7);
    const result = parseFlatCssDeclarationStylesheet('ignored.css', source);

    expect(result.source).toBe(source);
    expect(result.diagnostics).toEqual([]);
    expect(result.tree.rules).toHaveLength(2);
    expect(result.tree.rules[0]?.type).toBe('AtRuleStatement');
    expect(result.tree.rules[0]?.toTrimmedString()).toBe('@import "x.css";');
    expect(result.tree.rules[1]?.toTrimmedString()).toBe([
      '.kept {',
      '  color: green;',
      '}',
      ''
    ].join('\n'));
  });

  test('materializes only cheap structured selectors', () => {
    const result = parseFlatCssDeclarationStylesheet('selectors.css', `
      .simple { color: red; }
      #id.card { color: blue; }
      .a > .b + div { color: green; }
      [data-x] { color: black; }
      .a > DIV { color: white; }
      .a > { color: yellow; }
      .a > + .b { color: cyan; }
      #id.1bad { color: pink; }
      123.foo { color: orange; }
      -.foo { color: purple; }
      --.foo { color: brown; }
      #id.- { color: lime; }
      .a.#- { color: navy; }
    `);
    const [
      simpleRule,
      compoundRule,
      complexRule,
      attributeRule,
      uppercaseTypeRule,
      danglingCombinatorRule,
      consecutiveCombinatorRule,
      invalidClassRule,
      invalidTypeRule,
      bareHyphenTypeRule,
      doubleHyphenTypeRule,
      invalidClassHyphenRule,
      invalidIdHyphenRule
    ] = result.tree.rules;

    expect(result.diagnostics).toEqual([]);
    expect(isNode(simpleRule, N.Ruleset) && simpleRule.selector).toBe('.simple');
    expect(isNode(attributeRule, N.Ruleset) && attributeRule.selector).toBe('[data-x]');
    expect(isNode(uppercaseTypeRule, N.Ruleset) && uppercaseTypeRule.selector).toBe('.a > DIV');
    expect(isNode(danglingCombinatorRule, N.Ruleset) && danglingCombinatorRule.selector).toBe('.a >');
    expect(isNode(consecutiveCombinatorRule, N.Ruleset) && consecutiveCombinatorRule.selector).toBe('.a > + .b');
    expect(isNode(invalidClassRule, N.Ruleset) && invalidClassRule.selector).toBe('#id.1bad');
    expect(isNode(invalidTypeRule, N.Ruleset) && invalidTypeRule.selector).toBe('123.foo');
    expect(isNode(bareHyphenTypeRule, N.Ruleset) && bareHyphenTypeRule.selector).toBe('-.foo');
    expect(isNode(doubleHyphenTypeRule, N.Ruleset) && doubleHyphenTypeRule.selector).toBe('--.foo');
    expect(isNode(invalidClassHyphenRule, N.Ruleset) && invalidClassHyphenRule.selector).toBe('#id.-');
    expect(isNode(invalidIdHyphenRule, N.Ruleset) && invalidIdHyphenRule.selector).toBe('.a.#-');
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
  });

  test('parses cheap block at-rules and still rejects nested qualified rules', () => {
    const result = parseFlatCssDeclarationStylesheet('inline.css', `
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
    const { tree: root } = result;

    expect(result.diagnostics.map(diagnostic => diagnostic.code)).toEqual([
      'css-flat-unsupported-nested-block'
    ]);
    expect(root.rules).toHaveLength(2);
    const [media, kept] = root.rules;
    expect(isNode(media, N.AtRule)).toBe(true);
    if (!isNode(media, N.AtRule)) {
      throw new Error('Expected block at-rule');
    }
    expect(media.name).toBe('@media');
    expect(typeof media.prelude).not.toBe('string');
    expect(media.prelude?.toTrimmedString()).toBe('(min-width: 1px)');
    expect(serializeTypes(media)).toContainString(`
      (AtRule
        name: '@media'
        prelude:
          (Paren
            node:
              (Any 'min-width: 1px')
    `);
    expect(media.toTrimmedString()).toBe([
      '@media (min-width: 1px) {',
      '  .inside {',
      '    color: red;',
      '  }',
      '}',
      ''
    ].join('\n'));
    expect(isNode(kept, N.Ruleset)).toBe(true);
    if (!isNode(kept, N.Ruleset)) {
      throw new Error('Expected a ruleset');
    }
    expect(kept.selector).toBe('.kept');
    expect(kept.toTrimmedString()).toBe([
      '.kept {',
      '  color: green;',
      '}',
      ''
    ].join('\n'));
  });

  test('parses cheap comma-list at-rule preludes without raw broad strings', () => {
    const result = parseFlatCssDeclarationStylesheet('media-list.css', `
      @media screen and (min-width: 1px), print {
        .inside { color: red; }
      }
    `);
    const [media] = result.tree.rules;

    expect(result.diagnostics).toEqual([]);
    expect(isNode(media, N.AtRule)).toBe(true);
    if (!isNode(media, N.AtRule)) {
      throw new Error('Expected block at-rule');
    }
    expect(isNode(media.prelude, N.List)).toBe(true);
    if (!isNode(media.prelude, N.List)) {
      throw new Error('Expected List prelude');
    }
    expect(media.prelude.value.map(item => item.toTrimmedString())).toEqual([
      'screen and (min-width: 1px)',
      'print'
    ]);
    expect(serializeTypes(media)).toContainString(`
      (AtRule
        name: '@media'
        prelude:
          (List
    `);
    expect(serializeTypes(media)).toContain('(QueryCondition');
    expect(serializeTypes(media)).toContain('(Any \'print\')');
    expect(media.toTrimmedString()).toBe([
      '@media screen and (min-width: 1px), print {',
      '  .inside {',
      '    color: red;',
      '  }',
      '}',
      ''
    ].join('\n'));
  });

  test('diagnoses unsupported structured at-rule preludes instead of widening raw strings', () => {
    const result = parseFlatCssDeclarationStylesheet('unsupported-media.css', `
      @media screen and (foo, bar) {
        .comma { color: red; }
      }

      @media screen and (foo, bar), print {
        .comma-list { color: red; }
      }

      @media (foo[bar]) {
        .general { color: blue; }
      }
    `);

    expect(result.tree.rules).toEqual([]);
    expect(result.diagnostics.map(diagnostic => diagnostic.code)).toEqual([
      'css-flat-unsupported-at-rule',
      'css-flat-unsupported-at-rule',
      'css-flat-unsupported-at-rule'
    ]);
  });

  test('records offset-only diagnostics and maps positions lazily', () => {
    const result = parseFlatCssDeclarationStylesheet('broken.css', '.a { color: red;');

    expect(result.tree.rules).toHaveLength(0);
    expect(result.diagnostics).toEqual([{
      severity: 'error',
      code: 'css-flat-unclosed-block',
      message: 'Flat CSS declaration parser reached the end of source before the block closed.',
      start: 3,
      end: 16
    }]);
    expect(result.source.offsetToPosition(result.diagnostics[0]!.start)).toEqual({
      line: 1,
      column: 4
    });
  });

  test('diagnoses malformed at-rule statements instead of creating fake nodes', () => {
    const result = parseFlatCssDeclarationStylesheet('broken.css', '@;\n.kept { color: red; }');

    expect(result.diagnostics.map(diagnostic => diagnostic.code)).toEqual([
      'css-flat-malformed-at-rule-statement'
    ]);
    expect(result.tree.rules).toHaveLength(1);
    expect(result.tree.rules[0]?.toTrimmedString()).toBe([
      '.kept {',
      '  color: red;',
      '}',
      ''
    ].join('\n'));
  });
});
