import { serialize } from '../../core/src/ast/index.js';
import { parse } from '../src/direct-ast.js';

describe('parse', () => {
  it('constructs canonical AST-v2 literals without a build host and renders them', () => {
    const parsed = parse('/* top */\n.a { color: red; /* inside */ display: block }');

    expect(parsed.errors).toEqual([]);
    expect(parsed.document).toEqual({
      type: 'Root',
      children: [
        { type: 'Comment', text: '/* top */' },
        {
          type: 'Rule',
          selector: {
            type: 'SelectorList',
            selectors: [{
              type: 'Complex',
              head: { type: 'Compound', simples: [{ type: 'Simple', text: '.a', interp: null }] },
              tail: []
            }]
          },
          body: [
            {
              type: 'Declaration',
              name: 'color',
              value: { type: 'Keyword', src: 'red' },
              merge: null,
              important: false
            },
            { type: 'Comment', text: '/* inside */' },
            {
              type: 'Declaration',
              name: 'display',
              value: { type: 'Keyword', src: 'block' },
              merge: null,
              important: false
            }
          ]
        }
      ]
    });

    const rendered = serialize(parsed.document!);
    expect(rendered).not.toBeInstanceOf(Promise);
    if (rendered instanceof Promise) {
      throw new Error('direct CSS rendering must be synchronous');
    }
    expect(rendered.css).toContain('/* top */');
    expect(rendered.css).toContain('.a {');
    expect(rendered.css).toContain('color: red;');
    expect(rendered.css).toContain('display: block;');
    expect(rendered.css).toContain('/* inside */');
  });

  it('reports input outside the closed pilot grammar', () => {
    const parsed = parse('.a { color: 1px; }');
    expect(parsed.document).toBeNull();
    expect(parsed.errors).toHaveLength(1);
  });
});
