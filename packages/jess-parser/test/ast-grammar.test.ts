import { run } from 'parseman';
import type { Root } from '@jesscss/core/ast';
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
  it('constructs declaration, quoted, keyword, and variable-reference facts directly', () => {
    const result = run(
      jessAstGrammar.JessAstDocument,
      '$base: "dark";\n$tone: $base;\n$accent: blue;',
      { trivia: jessAstGrammar.whitespace }
    );

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(isRoot(result.value)).toBe(true);
    expect(result.value).toEqual({
      type: 'Root',
      children: [
        { type: 'VarDeclaration', name: 'base', value: { type: 'Quoted', src: '"dark"', value: 'dark', quote: '"', escaped: false } },
        { type: 'VarDeclaration', name: 'tone', value: { type: 'VarRef', name: 'base' } },
        { type: 'VarDeclaration', name: 'accent', value: { type: 'Keyword', src: 'blue' } }
      ]
    });
  });

  it('does not widen the declaration-only direct starter', () => {
    for (const source of [
      'color: red;',
      '$tone: red',
      '$tone: 1px;',
      '$tone: $;',
      '$\\66 oo: blue;',
      '$tone: "a\\"b";',
      '$tone: \'a\\\'b\';'
    ]) {
      const result = run(jessAstGrammar.JessAstDocument, source, { trivia: jessAstGrammar.whitespace });
      expect(result.ok && result.unconsumedFrom === null && isRoot(result.value)).toBe(false);
    }
  });
});
