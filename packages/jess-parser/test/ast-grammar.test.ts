import { run } from 'parseman';
import type { Root } from '@jesscss/core/ast';
import { parseJessCst } from '../src/cst.js';
import { jessAstGrammar } from '../src/ast/grammar.js';

function isRoot(value: unknown): value is Root {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'Root'
    && 'children' in value
    && Array.isArray(value.children);
}

describe('private Jess AST grammar facts', () => {
  it('constructs declarations, static rules, quoted, keyword, numeric, and variable-reference facts directly', () => {
    const source = '$base: "dark";\n$tone: $base;\n$accent: blue;\n$gap: -1.5e2rem;\n$ratio: .5;\n$percent: 50%;\n.card { color: $tone; margin: 1rem; }';
    const legacy = parseJessCst(source);
    const result = run(
      jessAstGrammar.JessAstDocument,
      source,
      { trivia: jessAstGrammar.whitespace }
    );

    expect(legacy.errors).toHaveLength(0);
    expect(legacy.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(isRoot(result.value)).toBe(true);
    expect(result.value).toEqual({
      type: 'Root',
      children: [
        { type: 'VarDeclaration', name: 'base', value: { type: 'Quoted', src: '"dark"', value: 'dark', quote: '"', escaped: false } },
        { type: 'VarDeclaration', name: 'tone', value: { type: 'VarRef', name: 'base' } },
        { type: 'VarDeclaration', name: 'accent', value: { type: 'Keyword', src: 'blue' } },
        { type: 'VarDeclaration', name: 'gap', value: { type: 'Dimension', number: -150, unit: 'rem', src: '-1.5e2rem' } },
        { type: 'VarDeclaration', name: 'ratio', value: { type: 'Dimension', number: 0.5, unit: '', src: '.5' } },
        { type: 'VarDeclaration', name: 'percent', value: { type: 'Dimension', number: 50, unit: '%', src: '50%' } },
        {
          type: 'Rule',
          selector: {
            type: 'SelectorList',
            selectors: [{ type: 'Complex', head: { type: 'Compound', simples: [{ type: 'Simple', text: '.card', interp: null }] }, tail: [] }]
          },
          body: [
            { type: 'Declaration', name: 'color', value: { type: 'VarRef', name: 'tone' }, merge: null, important: false },
            { type: 'Declaration', name: 'margin', value: { type: 'Dimension', number: 1, unit: 'rem', src: '1rem' }, merge: null, important: false }
          ]
        }
      ]
    });
  });

  it('keeps the direct rule route to one named basic-selector token', () => {
    for (const source of [
      '.card:hover { color: blue; }',
      '[role=tab] { color: blue; }',
      '50% { color: blue; }',
      '.card .title { color: blue; }',
      '.card-$[side] { color: blue; }'
    ]) {
      const legacy = parseJessCst(source);
      const direct = run(jessAstGrammar.JessAstDocument, source, { trivia: jessAstGrammar.whitespace });
      expect(legacy.errors).toHaveLength(0);
      expect(legacy.unconsumedFrom).toBeNull();
      expect(direct.ok && direct.unconsumedFrom === null && isRoot(direct.value)).toBe(false);
    }

    // A bare parent selector has no valid document-level production route, but
    // Jess accepts it inside a rule. The direct slice rejects nested rules until
    // it owns their parent-selector semantics rather than treating `&` as text.
    const nestedParent = '.parent { & { color: blue; } }';
    const legacy = parseJessCst(nestedParent);
    const direct = run(jessAstGrammar.JessAstDocument, nestedParent, { trivia: jessAstGrammar.whitespace });
    expect(legacy.errors).toHaveLength(0);
    expect(legacy.unconsumedFrom).toBeNull();
    expect(direct.ok && direct.unconsumedFrom === null && isRoot(direct.value)).toBe(false);
  });

  it('does not widen the closed direct declaration/value subset', () => {
    for (const source of [
      'color: red;',
      '$tone: red',
      '$tone: $;',
      '$tone: 1 px;',
      '$tone: 17px-1px;',
      '$\\66 oo: blue;',
      '$tone: "a\\"b";',
      '$tone: \'a\\\'b\';',
      '.card { color: blue }',
      '.card { color: blue red; }',
      '.card { $[property]: blue; }'
    ]) {
      const result = run(jessAstGrammar.JessAstDocument, source, { trivia: jessAstGrammar.whitespace });
      expect(result.ok && result.unconsumedFrom === null && isRoot(result.value)).toBe(false);
    }
  });
});
