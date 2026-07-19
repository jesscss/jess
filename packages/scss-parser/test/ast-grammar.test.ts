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
      '$base: blue; $theme: $base; $font: "Inter"; $escaped: r\\65d; $quoted: "a\\\\b"; $hash: "#foo"; $singleHash: \'#foo\';',
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
        { type: 'VarDeclaration', name: 'singleHash', value: { type: 'Quoted', src: '\'#foo\'', value: '#foo', quote: '\'', escaped: false } }
      ]
    });
  });

  it('keeps the closed direct-fact grammar narrow', () => {
    for (const source of [
      '$base: #00f;', '$base: blue', '$base: $base !default;', '$ba\\se: blue;', '$base: $ba\\se;',
      '$base: "#{tone}";', '$base: \'#{tone}\';'
    ]) {
      const result = run(scssAstGrammar.ScssAstDocument, source, { trivia: scssAstGrammar.whitespace });
      expect(result.ok && result.unconsumedFrom === null && isRoot(result.value)).toBe(false);
    }
  });
});
