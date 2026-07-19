import { describe, expect, it } from 'vitest';
import { run } from 'parseman';
import type { Root } from '@jesscss/core/ast';
import { serialize } from '../../core/src/ast/serialize.js';
import { cssAstGrammar } from '../src/ast/grammar.js';

function isRoot(value: unknown): value is Root {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'Root'
    && 'children' in value
    && Array.isArray(value.children);
}

function parseAst(input: string): Root {
  const result = run(cssAstGrammar.CssAstDocument, input, { trivia: cssAstGrammar.whitespace });
  if (!result.ok || result.unconsumedFrom !== null || !isRoot(result.value)) {
    throw new Error(`CSS AST grammar did not consume the document: ${JSON.stringify(result)}`);
  }
  return result.value;
}

describe('private CSS canonical-AST grammar', () => {
  it('constructs selector lists, compounds, declarations, and value lists directly from grammar reductions', () => {
    const document = parseAst('/* top */ .card.featured > #hero, main .card { color: red; margin: 12px 0; font-family: system-ui, sans-serif !important; }');

    expect(document).toMatchObject({
      type: 'Root',
      children: [
        { type: 'Comment', text: '/* top */' },
        {
          type: 'Rule',
          selector: {
            type: 'SelectorList',
            selectors: [
              {
                type: 'Complex',
                head: { type: 'Compound', simples: [{ type: 'Simple', text: '.card' }, { type: 'Simple', text: '.featured' }] },
                tail: [{ comb: '>', compound: { type: 'Compound', simples: [{ type: 'Simple', text: '#hero' }] } }]
              },
              {
                type: 'Complex',
                head: { type: 'Compound', simples: [{ type: 'Simple', text: 'main' }] },
                tail: [{ comb: ' ', compound: { type: 'Compound', simples: [{ type: 'Simple', text: '.card' }] } }]
              }
            ]
          },
          body: [
            { type: 'Declaration', name: 'color', value: { type: 'Keyword', src: 'red' }, merge: null, important: false },
            { type: 'Declaration', name: 'margin', value: { type: 'SpacedValue', parts: [{ type: 'Dimension', number: 12, unit: 'px', src: '12px' }, { type: 'Dimension', number: 0, unit: '', src: '0' }] } },
            { type: 'Declaration', name: 'font-family', value: { type: 'List', sep: ',', items: [{ type: 'Keyword', src: 'system-ui' }, { type: 'Keyword', src: 'sans-serif' }], separators: [','] }, important: true }
          ]
        }
      ]
    });

    expect(serialize(document)).toEqual({
      css: '/* top */\n.card.featured > #hero,\nmain .card {\n  color: red;\n  margin: 12px 0;\n  font-family: system-ui, sans-serif !important;\n}\n'
    });
  });

  it('keeps nested CSS rules and @media bodies as grammar-built AST statements', () => {
    const document = parseAst('@media screen { .card { color: #abc; .title { width: 100%; } } }');

    expect(document.children[0]).toMatchObject({
      type: 'AtRuleBlock',
      name: '@media',
      prelude: { type: 'Keyword', src: 'screen' }
    });
    expect(serialize(document)).toEqual({
      css: '@media screen {\n  .card {\n    color: #abc;\n  }\n  .card .title {\n    width: 100%;\n  }\n}\n'
    });
  });
});
