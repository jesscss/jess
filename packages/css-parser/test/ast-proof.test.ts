import { parseFlatCssDeclarationStylesheet } from '../src/index.js';
import { N, isNode } from '@jesscss/core';
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
    expect(result.diagnostics.map(diagnostic => diagnostic.code)).toEqual([
      'css-flat-unsupported-at-rule'
    ]);
    expect(result.tree.rules).toHaveLength(1);
    expect(result.tree.rules[0]?.toTrimmedString()).toBe([
      '.kept {',
      '  color: green;',
      '}',
      ''
    ].join('\n'));
  });

  test('does not turn unsupported at-rules or nested blocks into fake flat rulesets', () => {
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
      'css-flat-unsupported-at-rule',
      'css-flat-unsupported-nested-block'
    ]);
    expect(root.rules).toHaveLength(1);
    const [kept] = root.rules;
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
});
