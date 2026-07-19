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
  it('uses the shared basic-selector terminal without widening its closed CSS shape', () => {
    for (const input of ['* { color: red; }', '.c\\6f lor { color: red; }', '#hero { color: red; }']) {
      expect(parseAst(input).children[0]).toMatchObject({ type: 'Rule' });
    }
    for (const input of ['@name { color: red; }', ':hover { color: red; }', '[role=button] { color: red; }']) {
      expect(() => parseAst(input)).toThrow();
    }
  });

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

  it('constructs non-import statement at-rule preludes directly from value reductions', () => {
    const document = parseAst('@namespace svg url("https://example.test/ns"); @layer utilities; @layer; .card { color: red; }');

    expect(document.children).toMatchObject([
      {
        type: 'AtRuleStatement',
        name: '@namespace',
        prelude: {
          type: 'SpacedValue',
          parts: [
            { type: 'Keyword', src: 'svg' },
            { type: 'Url', value: { type: 'Quoted', value: 'https://example.test/ns' } }
          ]
        }
      },
      { type: 'AtRuleStatement', name: '@layer', prelude: { type: 'Keyword', src: 'utilities' } },
      { type: 'AtRuleStatement', name: '@layer', prelude: null },
      { type: 'Rule' }
    ]);
    expect(serialize(document)).toEqual({
      css: '@namespace svg url("https://example.test/ns");\n@layer utilities;\n@layer;\n.card {\n  color: red;\n}\n'
    });
  });

  it('constructs case-insensitive named and anonymous @layer blocks as structured AST subtrees', () => {
    const document = parseAst('@LAYER utilities.components { .card { color: red; } } @layer { .reset { margin: 0; } }');

    expect(document.children).toMatchObject([
      {
        type: 'AtRuleBlock',
        name: '@layer',
        prelude: { type: 'Keyword', src: 'utilities.components' },
        body: [{ type: 'Rule', selector: { type: 'SelectorList' } }]
      },
      {
        type: 'AtRuleBlock',
        name: '@layer',
        prelude: null,
        body: [{ type: 'Rule', selector: { type: 'SelectorList' } }]
      }
    ]);
    expect(serialize(document)).toEqual({
      css: '@layer utilities.components {\n  .card {\n    color: red;\n  }\n}\n@layer {\n  .reset {\n    margin: 0;\n  }\n}\n'
    });
  });

  it('constructs keyframe selector blocks directly instead of treating keyframes as ordinary rulesets', () => {
    const document = parseAst('@KEYFRAMES fade { /* half-way */ from, 50% { opacity: 0; } to { opacity: 1; } } @-MOZ-KEYFRAMES zoom { from { opacity: 0; } }');

    expect(document.children).toMatchObject([
      {
        type: 'AtRuleBlock',
        name: '@KEYFRAMES',
        prelude: { type: 'Keyword', src: 'fade' },
        body: [
          { type: 'Comment', text: '/* half-way */' },
          {
            type: 'Rule',
            selector: {
              type: 'SelectorList',
              selectors: [
                { type: 'Complex', head: { simples: [{ type: 'Simple', text: 'from' }] } },
                { type: 'Complex', head: { simples: [{ type: 'Simple', text: '50%' }] } }
              ]
            },
            body: [{ type: 'Declaration', name: 'opacity' }]
          },
          {
            type: 'Rule',
            selector: { type: 'SelectorList', selectors: [{ type: 'Complex', head: { simples: [{ type: 'Simple', text: 'to' }] } }] }
          }
        ]
      },
      {
        type: 'AtRuleBlock',
        name: '@-MOZ-KEYFRAMES',
        prelude: { type: 'Keyword', src: 'zoom' },
        body: [{ type: 'Rule', selector: { type: 'SelectorList' } }]
      }
    ]);
    expect(serialize(document)).toEqual({
      css: '@KEYFRAMES fade {\n  /* half-way */\n  from,\n  50% {\n    opacity: 0;\n  }\n  to {\n    opacity: 1;\n  }\n}\n@-MOZ-KEYFRAMES zoom {\n  from {\n    opacity: 0;\n  }\n}\n'
    });
  });

  it('rejects non-keyframe selectors and bare declarations in a keyframes body', () => {
    for (const input of ['@keyframes fade { .card { opacity: 0; } }', '@keyframes fade { opacity: 0; }', '@keyframes fade { 50px { opacity: 0; } }']) {
      expect(() => parseAst(input)).toThrow('CSS AST grammar did not consume the document');
    }
  });

  it('rejects non-boundary @layer prefixes and comma-separated block names', () => {
    for (const input of ['@layered { .card { color: red; } }', '@layer-foo { .card { color: red; } }', '@layer utilities, components { .card { color: red; } }']) {
      expect(() => parseAst(input)).toThrow('CSS AST grammar did not consume the document');
    }
  });

  it('constructs static CSS import targets and lossless grammar-owned tail facts without resolution', () => {
    const document = parseAst('@IMPORT "theme.css" layer(theme) /* keep */ supports(display: grid) screen and (min-width: 40rem); @import url(icons.css) print; @import url("quoted.css"); @import url();');

    expect(document.children).toMatchObject([
      {
        type: 'ImportAtRule',
        name: '@IMPORT',
        options: null,
        target: { type: 'Quoted', src: '"theme.css"', value: 'theme.css' },
        alias: null,
        tail: { type: 'Any', src: 'layer(theme) /* keep */ supports(display: grid) screen and (min-width: 40rem)' }
      },
      {
        type: 'ImportAtRule',
        name: '@import',
        target: { type: 'Url', value: { type: 'Any', src: 'icons.css' } },
        tail: { type: 'Any', src: 'print' }
      },
      {
        type: 'ImportAtRule',
        target: { type: 'Url', value: { type: 'Quoted', src: '"quoted.css"', value: 'quoted.css' } },
        tail: null
      },
      {
        type: 'ImportAtRule',
        target: { type: 'Url', value: { type: 'Any', src: '' } },
        tail: null
      }
    ]);
    expect(serialize(document)).toEqual({
      css: '@IMPORT "theme.css" layer(theme) /* keep */ supports(display: grid) screen and (min-width: 40rem);\n@import url(icons.css) print;\n@import url("quoted.css");\n@import url();\n'
    });
  });

  it('preserves whitespace and comments outside CSS import tail groups', () => {
    const document = parseAst('@import "x.css" /* comment */  screen and ( color : red );');

    expect(document.children[0]).toMatchObject({
      type: 'ImportAtRule',
      tail: { type: 'Any', src: '/* comment */  screen and ( color : red )' }
    });
    expect(serialize(document)).toEqual({
      css: '@import "x.css" /* comment */  screen and ( color : red );\n'
    });
  });

  it('keeps @import outside the generic statement family and rejects malformed typed boundaries', () => {
    const result = run(cssAstGrammar.CssAstAtRuleStatement, '@import "theme.css";', { trivia: cssAstGrammar.whitespace });

    expect(result.ok).toBe(false);
    for (const input of [
      '@import;',
      '@import "theme.css" supports(display: grid;',
      '@import url(foo bar);'
    ]) {
      expect(() => parseAst(input)).toThrow();
    }
    expect(run(cssAstGrammar.CssAstImport, '@imported "theme.css";', { trivia: cssAstGrammar.whitespace }).ok).toBe(false);
  });

  it('constructs quoted, url, and function values without a value re-parser', () => {
    const document = parseAst('.asset { content: "hello\\\"world"; background: url("icons\\\"logo.svg"); color: rgb(255, 0, 128); }');

    expect(document.children[0]).toMatchObject({
      type: 'Rule',
      body: [
        { type: 'Declaration', name: 'content', value: { type: 'Quoted', src: '"hello\\\"world"', value: 'hello\\\"world', quote: '"', escaped: false } },
        { type: 'Declaration', name: 'background', value: { type: 'Url', value: { type: 'Quoted', value: 'icons\\\"logo.svg' } } },
        { type: 'Declaration', name: 'color', value: { type: 'FunctionCall', name: 'rgb', args: [{ type: 'Dimension', number: 255 }, { type: 'Dimension', number: 0 }, { type: 'Dimension', number: 128 }] } }
      ]
    });
    expect(serialize(document)).toEqual({
      css: '.asset {\n  content: "hello\\\"world";\n  background: url("icons\\\"logo.svg");\n  color: rgb(255, 0, 128);\n}\n'
    });
  });

  it('captures custom declarations as one grammar-owned opaque value through balanced groups and quoted terminators', () => {
    const document = parseAst('.theme { --palette: { primary: rgb(1; 2); nested: ["}"; /* ; } */]; }; color: red; }');

    expect(document.children[0]).toMatchObject({
      type: 'Rule',
      body: [
        {
          type: 'Declaration',
          name: '--palette',
          value: { type: 'Any', src: '{ primary: rgb(1; 2); nested: ["}"; /* ; } */]; }' },
          important: false
        },
        { type: 'Declaration', name: 'color', value: { type: 'Keyword', src: 'red' } }
      ]
    });
    expect(serialize(document)).toEqual({
      css: '.theme {\n  --palette: { primary: rgb(1; 2); nested: ["}"; /* ; } */]; };\n  color: red;\n}\n'
    });
  });

  it('does not classify an ordinary declaration or a malformed custom-property boundary as a custom declaration', () => {
    expect(parseAst('.theme { color: red; }').children[0]).toMatchObject({
      type: 'Rule',
      body: [{ type: 'Declaration', name: 'color', value: { type: 'Keyword', src: 'red' } }]
    });
    expect(() => parseAst('.theme { --palette: { primary: red; }')).toThrow('CSS AST grammar did not consume the document');
    expect(() => parseAst('.theme { --: red; }')).toThrow('CSS AST grammar did not consume the document');
  });

  it('keeps escaped declaration terminators and an empty custom value inside the custom-property grammar', () => {
    const document = parseAst('.theme { --escaped: before\\;after\\}still-value; --empty: ; color: red; }');

    expect(document.children[0]).toMatchObject({
      type: 'Rule',
      body: [
        { type: 'Declaration', name: '--escaped', value: { type: 'Any', src: 'before\\;after\\}still-value' } },
        { type: 'Declaration', name: '--empty', value: { type: 'Any', src: '' } },
        { type: 'Declaration', name: 'color', value: { type: 'Keyword', src: 'red' } }
      ]
    });
    expect(serialize(document)).toEqual({
      css: '.theme {\n  --escaped: before\\;after\\}still-value;\n  --empty: ;\n  color: red;\n}\n'
    });
  });

  it('accepts an escaped identifier start after the custom-property prefix', () => {
    const document = parseAst('.theme { --\\31 accent: red; }');

    expect(document.children[0]).toMatchObject({
      type: 'Rule',
      body: [{ type: 'Declaration', name: '--\\31 accent', value: { type: 'Any', src: 'red' } }]
    });
    expect(serialize(document)).toEqual({ css: '.theme {\n  --\\31 accent: red;\n}\n' });
  });

  it('commits url() after its opener instead of falling back to a generic call', () => {
    const result = run(cssAstGrammar.CssAstDocument, '.a { background: url(foo bar); }', { trivia: cssAstGrammar.whitespace });

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ expected: [')'] });
  });

  it('keeps unquoted url payload bytes when building ordinary declarations', () => {
    const document = parseAst('.asset { background: url(icon.svg); }');

    expect(document.children[0]).toMatchObject({
      type: 'Rule',
      body: [{ type: 'Declaration', name: 'background', value: { type: 'Url', value: { type: 'Any', src: 'icon.svg' } } }]
    });
    expect(serialize(document)).toEqual({ css: '.asset {\n  background: url(icon.svg);\n}\n' });
  });

  it('recognizes escaped url-token payloads through the fused private syntax leaves', () => {
    const document = parseAst('.asset { background: url(icon\\41 svg); content: \'it\\\\\\\'s\'; }');

    expect(document.children[0]).toMatchObject({
      type: 'Rule',
      body: [
        { type: 'Declaration', name: 'background', value: { type: 'Url', value: { type: 'Any', src: 'icon\\41 svg' } } },
        { type: 'Declaration', name: 'content', value: { type: 'Quoted', src: '\'it\\\\\\\'s\'', value: 'it\\\\\\\'s', quote: '\'' } }
      ]
    });
    expect(serialize(document)).toEqual({ css: '.asset {\n  background: url(icon\\41 svg);\n  content: \'it\\\\\\\'s\';\n}\n' });
  });

  it('constructs an empty generic function call without inventing an argument', () => {
    const document = parseAst('.a { transform: translate(); }');

    expect(document.children[0]).toMatchObject({
      type: 'Rule',
      body: [{ type: 'Declaration', name: 'transform', value: { type: 'FunctionCall', name: 'translate', args: [] } }]
    });
    expect(serialize(document)).toEqual({ css: '.a {\n  transform: translate();\n}\n' });
  });

  it('builds calc arithmetic and parentheses directly as canonical value nodes', () => {
    const document = parseAst('.a { width: calc(1px + 2px * (3 - 4)); }');

    expect(document.children[0]).toMatchObject({
      type: 'Rule',
      body: [{
        type: 'Declaration',
        name: 'width',
        value: {
          type: 'FunctionCall',
          name: 'calc',
          args: [{
            type: 'Operation',
            operator: '+',
            left: { type: 'Dimension', number: 1, unit: 'px' },
            right: {
              type: 'Operation',
              operator: '*',
              left: { type: 'Dimension', number: 2, unit: 'px' },
              right: {
                type: 'Paren',
                inner: {
                  type: 'Operation',
                  operator: '-',
                  left: { type: 'Dimension', number: 3, unit: '' },
                  right: { type: 'Dimension', number: 4, unit: '' }
                }
              }
            }
          }]
        }
      }]
    });
    expect(serialize(document)).toEqual({ css: '.a {\n  width: calc(1px + 2px * (3 - 4));\n}\n' });
  });

  it('rejects malformed calc syntax at recognition without a reduction fallback', () => {
    for (const input of [
      '.a { width: calc(); }',
      '.a { width: calc(+); }',
      '.a { width: calc(1px +2px); }',
      '.a { width: calc(1px+ 2px); }',
      '.a { width: calc(1px -2px); }',
      '.a { width: calc(5px % 2); }',
      '.a { width: (1px); }'
    ]) {
      expect(() => {
        const result = run(cssAstGrammar.CssAstDocument, input, { trivia: cssAstGrammar.whitespace });
        expect(result.ok && result.unconsumedFrom === null).toBe(false);
      }).not.toThrow();
    }
  });

  it('recognizes CSS importance as a declaration flag with case and trivia permitted by grammar', () => {
    const document = parseAst('.a { color: red ! IMPORTANT; }');

    expect(document.children[0]).toMatchObject({
      type: 'Rule',
      body: [{ type: 'Declaration', name: 'color', important: true, value: { type: 'Keyword', src: 'red' } }]
    });
    expect(serialize(document)).toEqual({ css: '.a {\n  color: red !important;\n}\n' });
  });
});
