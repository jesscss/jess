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
    const [color, background, custom] = firstRule.rules;
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

  test('keeps atomic selectors as strings and materializes cheap selector structure', () => {
    const result = parseFlatCssDeclarationStylesheet('selectors.css', `
      .simple { color: red; }
      #id.card { color: blue; }
      .a:hover::before { color: magenta; }
      .a > .b + div { color: green; }
      [data-x] { color: black; }
      .a[data-x] { color: gray; }
      .a > DIV { color: white; }
      .a, .b { color: black; }
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
      pseudoRule,
      complexRule,
      attributeRule,
      attributeCompoundRule,
      selectorListRule
    ] = result.tree.rules;

    expect(result.diagnostics.map(diagnostic => diagnostic.code)).toEqual([
      'css-flat-unsupported-selector',
      'css-flat-unsupported-selector',
      'css-flat-unsupported-selector',
      'css-flat-unsupported-selector',
      'css-flat-unsupported-selector',
      'css-flat-unsupported-selector',
      'css-flat-unsupported-selector',
      'css-flat-unsupported-selector',
      'css-flat-unsupported-selector'
    ]);
    expect(isNode(simpleRule, N.Ruleset) && simpleRule.selector).toBe('.simple');
    expect(isNode(attributeRule, N.Ruleset) && attributeRule.selector).toBe('[data-x]');
    expect(isNode(attributeCompoundRule, N.Ruleset) && isNode(attributeCompoundRule.selector, N.CompoundSelector)).toBe(true);
    expect(isNode(compoundRule, N.Ruleset) && isNode(compoundRule.selector, N.CompoundSelector)).toBe(true);
    expect(isNode(pseudoRule, N.Ruleset) && isNode(pseudoRule.selector, N.CompoundSelector)).toBe(true);
    expect(isNode(complexRule, N.Ruleset) && isNode(complexRule.selector, N.ComplexSelector)).toBe(true);
    expect(isNode(selectorListRule, N.Ruleset) && isNode(selectorListRule.selector, N.SelectorList)).toBe(true);
    if (!isNode(compoundRule, N.Ruleset) || !isNode(compoundRule.selector, N.CompoundSelector)) {
      throw new Error('Expected string-backed compound selector');
    }
    if (!isNode(pseudoRule, N.Ruleset) || !isNode(pseudoRule.selector, N.CompoundSelector)) {
      throw new Error('Expected string-backed pseudo compound selector');
    }
    if (!isNode(attributeCompoundRule, N.Ruleset) || !isNode(attributeCompoundRule.selector, N.CompoundSelector)) {
      throw new Error('Expected string-backed attribute compound selector');
    }
    if (!isNode(complexRule, N.Ruleset) || !isNode(complexRule.selector, N.ComplexSelector)) {
      throw new Error('Expected string-backed complex selector');
    }
    if (!isNode(selectorListRule, N.Ruleset) || !isNode(selectorListRule.selector, N.SelectorList)) {
      throw new Error('Expected string-backed selector list');
    }
    expect(compoundRule.selector.value).toEqual(['#id', '.card']);
    expect(pseudoRule.selector.value).toEqual(['.a', ':hover', '::before']);
    expect(attributeCompoundRule.selector.value).toEqual(['.a', '[data-x]']);
    expect(complexRule.selector.value).toEqual(['.a', '>', '.b', '+', 'div']);
    expect(selectorListRule.selector.value).toEqual(['.a', '.b']);
    expect(serializeTypes(compoundRule)).not.toContain('(BasicSelector');
    expect(serializeTypes(pseudoRule)).not.toContain('(PseudoSelector');
    expect(serializeTypes(attributeCompoundRule)).not.toContain('(AttributeSelector');
    expect(serializeTypes(complexRule)).not.toContain('(Combinator');
    expect(serializeTypes(selectorListRule)).toContain('(SelectorList');
    expect(serializeTypes(selectorListRule)).not.toContain('(BasicSelector');
  });

  test('skips selector comments while preserving cheap selector shape', () => {
    const result = parseFlatCssDeclarationStylesheet('selector-comments.css', `
      a/* { } */ b {}
      a/* test */b {}
    `);
    const [descendantRule, compoundRule] = result.tree.rules;

    expect(result.diagnostics).toEqual([]);
    expect(isNode(descendantRule, N.Ruleset)).toBe(true);
    expect(isNode(compoundRule, N.Ruleset)).toBe(true);
    if (!isNode(descendantRule, N.Ruleset) || !isNode(compoundRule, N.Ruleset)) {
      throw new Error('Expected rulesets');
    }
    expect(isNode(descendantRule.selector, N.ComplexSelector)).toBe(true);
    expect(isNode(compoundRule.selector, N.CompoundSelector)).toBe(true);
    if (!isNode(descendantRule.selector, N.ComplexSelector) || !isNode(compoundRule.selector, N.CompoundSelector)) {
      throw new Error('Expected comment-normalized selector nodes');
    }
    expect(descendantRule.selector.value).toEqual(['a', ' ', 'b']);
    expect(compoundRule.selector.value).toEqual(['a', 'b']);
    expect(serializeTypes(descendantRule)).not.toContain('(BasicSelector');
    expect(serializeTypes(compoundRule)).not.toContain('(BasicSelector');
  });

  test('diagnoses malformed selector-list boundaries instead of dropping empty branches', () => {
    const result = parseFlatCssDeclarationStylesheet('selector-list-boundary.css', `
      .a, { color: red; }
      .b,   { color: blue; }
    `);

    expect(result.tree.rules).toEqual([]);
    expect(result.diagnostics.map(diagnostic => diagnostic.code)).toEqual([
      'css-flat-unsupported-selector',
      'css-flat-unsupported-selector'
    ]);
  });

  test('parses cheap block at-rules and nested qualified rules', () => {
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

    expect(result.diagnostics).toEqual([]);
    expect(root.rules).toHaveLength(3);
    const [media, outer, kept] = root.rules;
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
    expect(isNode(outer, N.Ruleset)).toBe(true);
    if (!isNode(outer, N.Ruleset)) {
      throw new Error('Expected outer ruleset');
    }
    expect(outer.selector).toBe('.outer');
    expect(outer.rules).toHaveLength(1);
    const nested = outer.rules[0];
    expect(isNode(nested, N.Ruleset)).toBe(true);
    if (!isNode(nested, N.Ruleset)) {
      throw new Error('Expected nested ruleset');
    }
    expect(nested.selector).toBe('.nested');
    expect(nested.toTrimmedString()).toBe([
      '.nested {',
      '  color: blue;',
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

  test('parses cheap page at-rule selectors as existing ident list preludes', () => {
    const result = parseFlatCssDeclarationStylesheet('page.css', `
      @page :left { background: black }
      @page Test:First, :right { margin: 1cm; }
      @page { @top-left { content: "chapter"; } }
    `);
    const [leftPage, namedPage, pageWithMarginBox] = result.tree.rules;

    expect(result.diagnostics).toEqual([]);
    expect(isNode(leftPage, N.AtRule)).toBe(true);
    expect(isNode(namedPage, N.AtRule)).toBe(true);
    expect(isNode(pageWithMarginBox, N.AtRule)).toBe(true);
    if (!isNode(leftPage, N.AtRule) || !isNode(namedPage, N.AtRule) || !isNode(pageWithMarginBox, N.AtRule)) {
      throw new Error('Expected page at-rules');
    }
    expect(leftPage.name).toBe('@page');
    expect(isNode(leftPage.prelude, N.List)).toBe(true);
    expect(isNode(namedPage.prelude, N.List)).toBe(true);
    if (!isNode(leftPage.prelude, N.List) || !isNode(namedPage.prelude, N.List)) {
      throw new Error('Expected page selector prelude lists');
    }
    expect(leftPage.prelude.items.map(item => item.valueOf())).toEqual([':left']);
    expect(namedPage.prelude.items.map(item => item.valueOf())).toEqual(['Test:First', ':right']);
    expect(serializeTypes(leftPage)).toContainString(`
      prelude:
        (List
          items:
            [
              (Any [role=ident] ':left')
            ]
        )
    `);
    expect(leftPage.toTrimmedString()).toBe([
      '@page :left {',
      '  background: black;',
      '}',
      ''
    ].join('\n'));
    const [marginBox] = pageWithMarginBox.rules;
    expect(isNode(marginBox, N.AtRule)).toBe(true);
    if (!isNode(marginBox, N.AtRule)) {
      throw new Error('Expected page margin box at-rule');
    }
    expect(marginBox.name).toBe('@top-left');
    expect(serializeTypes(marginBox)).toContainString(`
      rules:
        [
          (Declaration
            name: 'content'
            value: '"chapter"'
          )
        ]
    `);
  });

  test('diagnoses malformed page selector lists instead of dropping empty branches', () => {
    const result = parseFlatCssDeclarationStylesheet('page.css', `
      @page Test:first, { margin: 1cm; }
      @page , :left { margin: 1cm; }
      @page :foo { margin: 1cm; }
    `);

    expect(result.tree.rules).toEqual([]);
    expect(result.diagnostics.map(diagnostic => diagnostic.code)).toEqual([
      'css-flat-unsupported-at-rule',
      'css-flat-unsupported-at-rule',
      'css-flat-unsupported-at-rule'
    ]);
  });

  test('preserves empty rulesets instead of treating them as unsupported blocks', () => {
    const result = parseFlatCssDeclarationStylesheet('empty.css', `
      .empty {}
      @media screen { .inside {} }
    `);
    const [emptyRule, media] = result.tree.rules;

    expect(result.diagnostics).toEqual([]);
    expect(isNode(emptyRule, N.Ruleset)).toBe(true);
    if (!isNode(emptyRule, N.Ruleset)) {
      throw new Error('Expected empty ruleset');
    }
    expect(emptyRule.selector).toBe('.empty');
    expect(emptyRule.rules).toEqual([]);
    expect(isNode(media, N.AtRule)).toBe(true);
    if (!isNode(media, N.AtRule)) {
      throw new Error('Expected media at-rule');
    }
    expect(media.rules).toHaveLength(1);
    expect(media.rules[0]?.toTrimmedString()).toBe('');
    expect(serializeTypes(media)).toContainString(`
      (AtRule
        name: '@media'
        prelude: 'screen'
        rules:
          [
            (Ruleset
              selector: '.inside'
              rules:
                []
            )
          ]
      )
    `);
  });

  test('diagnoses unsupported colon selectors without swallowing following declarations', () => {
    const result = parseFlatCssDeclarationStylesheet('unsupported-nesting.css', `
      .a {
        &:hover { color: red; }
        color: blue;
      }
    `);
    const [rule] = result.tree.rules;

    expect(result.diagnostics.map(diagnostic => diagnostic.code)).toEqual([
      'css-flat-unsupported-selector'
    ]);
    expect(isNode(rule, N.Ruleset)).toBe(true);
    if (!isNode(rule, N.Ruleset)) {
      throw new Error('Expected outer ruleset');
    }
    expect(rule.rules).toHaveLength(1);
    expect(rule.rules[0]?.toTrimmedString()).toBe('color: blue');
    expect(rule.toTrimmedString()).toBe([
      '.a {',
      '  color: blue;',
      '}',
      ''
    ].join('\n'));
  });

  test('parses empty semicolon statements as existing semi nodes', () => {
    const result = parseFlatCssDeclarationStylesheet('semicolons.css', `
      a {;;
        color: black;
        ; ;
      }
    `);
    const [rule] = result.tree.rules;

    expect(result.diagnostics).toEqual([]);
    expect(isNode(rule, N.Ruleset)).toBe(true);
    if (!isNode(rule, N.Ruleset)) {
      throw new Error('Expected ruleset');
    }
    expect(rule.rules.map(node => node.toTrimmedString())).toEqual([
      ';',
      ';',
      'color: black',
      ';',
      ';'
    ]);
    expect(serializeTypes(rule)).toContainString(`
      rules:
        [
          (Any [role=semi] ';')
          (Any [role=semi] ';')
          (Declaration
    `);
    expect(rule.toTrimmedString()).toBe([
      'a {',
      '  ;',
      '  ;',
      '  color: black;',
      '  ;',
      '  ;',
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
