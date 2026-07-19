import { run } from 'parseman';
import type { Root } from '@jesscss/core/ast';
import { scssAstGrammar } from '../src/ast/grammar.js';

function isRoot(value: unknown): value is Root {
  return typeof value === 'object' && value !== null && 'type' in value && value.type === 'Root'
    && 'children' in value && Array.isArray(value.children);
}

describe('private SCSS AST grammar facts', () => {
  it('constructs canonical SCSS variable declarations and references directly', () => {
    const result = run(
      scssAstGrammar.ScssAstDocument,
      '$base: blue; $theme: $base; $font: "Inter"; $escaped: r\\65d; $quoted: "a\\\\b"; $hash: "#foo"; $singleHash: \'#foo\'; $shadow: 0 1px #000,\n    0 2px #fff; $asset: url("font.woff2"); $gradient: linear-gradient(#000, rgb(1, 2, 3)); .card { color: #00f; margin: 1.5rem; opacity: .5; background: url(images/a#icon.svg); }',
      { trivia: scssAstGrammar.whitespace }
    );

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(isRoot(result.value)).toBe(true);
    expect(result.value).toEqual({
      type: 'Root',
      children: [
        { type: 'VarDeclaration', name: 'base', value: { type: 'Keyword', src: 'blue' } },
        { type: 'VarDeclaration', name: 'theme', value: { type: 'VarRef', name: 'base' } },
        { type: 'VarDeclaration', name: 'font', value: { type: 'Quoted', src: '"Inter"', value: 'Inter', quote: '"', escaped: false } },
        // Value keywords deliberately preserve CSS escapes. `$` names above use
        // the SCSS-local unescaped terminal instead.
        { type: 'VarDeclaration', name: 'escaped', value: { type: 'Keyword', src: 'r\\65d' } },
        { type: 'VarDeclaration', name: 'quoted', value: { type: 'Quoted', src: '"a\\\\b"', value: 'a\\\\b', quote: '"', escaped: true } },
        { type: 'VarDeclaration', name: 'hash', value: { type: 'Quoted', src: '"#foo"', value: '#foo', quote: '"', escaped: false } },
        { type: 'VarDeclaration', name: 'singleHash', value: { type: 'Quoted', src: '\'#foo\'', value: '#foo', quote: '\'', escaped: false } },
        {
          type: 'VarDeclaration', name: 'shadow', value: {
            type: 'List', sep: ',', separators: [',\n    '], items: [
              { type: 'SpacedValue', parts: [{ type: 'Dimension', number: 0, unit: '', src: '0' }, { type: 'Dimension', number: 1, unit: 'px', src: '1px' }, { type: 'Color', src: '#000' }] },
              { type: 'SpacedValue', parts: [{ type: 'Dimension', number: 0, unit: '', src: '0' }, { type: 'Dimension', number: 2, unit: 'px', src: '2px' }, { type: 'Color', src: '#fff' }] }
            ]
          }
        },
        { type: 'VarDeclaration', name: 'asset', value: { type: 'Url', value: { type: 'Quoted', src: '"font.woff2"', value: 'font.woff2', quote: '"', escaped: false } } },
        {
          type: 'VarDeclaration', name: 'gradient', value: {
            type: 'FunctionCall', name: 'linear-gradient', modern: false, args: [
              { type: 'Color', src: '#000' },
              { type: 'FunctionCall', name: 'rgb', modern: false, args: [
                { type: 'Dimension', number: 1, unit: '', src: '1' },
                { type: 'Dimension', number: 2, unit: '', src: '2' },
                { type: 'Dimension', number: 3, unit: '', src: '3' }
              ] }
            ]
          }
        },
        {
          type: 'Rule',
          selector: {
            type: 'SelectorList',
            selectors: [{ type: 'Complex', head: { type: 'Compound', simples: [{ type: 'Simple', text: '.card', interp: null }] }, tail: [] }]
          },
          body: [
            { type: 'Declaration', name: 'color', value: { type: 'Color', src: '#00f' }, merge: null, important: false },
            { type: 'Declaration', name: 'margin', value: { type: 'Dimension', number: 1.5, unit: 'rem', src: '1.5rem' }, merge: null, important: false },
            { type: 'Declaration', name: 'opacity', value: { type: 'Dimension', number: 0.5, unit: '', src: '.5' }, merge: null, important: false },
            { type: 'Declaration', name: 'background', value: { type: 'Url', value: { type: 'Any', src: 'images/a#icon.svg' } }, merge: null, important: false }
          ]
        }
      ]
    });
  });

  it('keeps the closed direct-fact grammar narrow', () => {
    for (const source of [
      '$base: blue', '$base: $base !default;', '$ba\\se: blue;', '$base: $ba\\se;',
      '$base: "#{tone}";', '$base: \'#{tone}\';', '.#{$name} { color: blue; }',
      '.card { #{$property}: blue; }', '.card { color: #{$value}; }', '.card { color: blue }',
      '.card { margin: 17px-1px; }', '.card { color: url(#{asset}); }',
      '.card { color: fn(#{asset}); }', '.card { color: fn(blue, #{asset}); }',
      '.card { color: #fffff; }', '.card { color: #1234567; }'
    ]) {
      const result = run(scssAstGrammar.ScssAstDocument, source, { trivia: scssAstGrammar.whitespace });
      expect(result.ok && result.unconsumedFrom === null && isRoot(result.value), source).toBe(false);
    }
  });
});
