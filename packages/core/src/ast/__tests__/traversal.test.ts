import { describe, expect, it } from 'vitest';
import { cssBaseMathOutsideParens,
  collection,
  collectionEntry,
  decl,
  dimension,
  funcCall,
  interpolation,
  keyword,
  list,
  mixinCall,
  mixinDef,
  operation,
  rule,
  sel,
  selist,
  spaced,
  stylesheet,
  variableDeclaration
} from '../nodes.js';
import { walkAuthoredAst, walkAuthoredValue, type AstEdge } from '../traversal.js';

describe('canonical authored AST traversal', () => {
  it('walks nested value dimensions without consumer-owned object crawling', () => {
    const seen: string[] = [];

    walkAuthoredValue(funcCall('calc', [
      operation('+', dimension(0, 'px', '0px'), dimension(1, 'em', '1em'), false, cssBaseMathOutsideParens('+')),
      list([
        spaced([dimension(0, 'rem', '0rem'), keyword('auto')]),
        [dimension(0, 'vh', '0vh')]
      ], ',')
    ]), {
      enterNode(node) {
        if (node.type === 'Dimension') {
          seen.push(`${node.src}:${node.unit}`);
        }
      }
    });

    expect(seen).toEqual(['0px:px', '1em:em', '0rem:rem', '0vh:vh']);
  });

  it('supports read-only pruning with skip-children', () => {
    const seen: string[] = [];

    walkAuthoredValue(funcCall('outer', [
      funcCall('inner', [dimension(0, 'px', '0px')])
    ]), {
      enterNode(node) {
        seen.push(node.type);
        if (node.type === 'FunctionCall') {
          return 'skip-children';
        }
      }
    });

    expect(seen).toEqual(['FunctionCall']);
  });

  it('lets a lazy bridge traverse through uninterested ancestors without adapting them', () => {
    const adapted: string[] = [];
    const visitorCalls: string[] = [];
    const interested = new Set(['Dimension']);

    walkAuthoredAst(stylesheet([
      rule('.x', [decl('width', funcCall('calc', [dimension(0, 'px', '0px')]))])
    ]), {
      enterNode(node) {
        if (!interested.has(node.type)) {
          return;
        }
        adapted.push(node.type);
        visitorCalls.push(`visit${node.type}`);
      }
    });

    expect(adapted).toEqual(['Dimension']);
    expect(visitorCalls).toEqual(['visitDimension']);
  });

  it('owns statement, selector, guard, extend, collection, and call-value edges', () => {
    const edges: AstEdge[] = [];
    const name = interpolation([
      { lit: '--' },
      { ref: keyword('gap'), unquote: false }
    ]);
    const guard = {
      g: 'cmp',
      op: '>',
      left: dimension(1),
      right: dimension(0)
    } as const;
    const target = selist(sel('.target'));
    const subject = selist(sel('.subject'));
    const document = stylesheet([
      rule('.host', [
        decl(name, collection([
          collectionEntry(keyword('entry'), dimension(0, 'px', '0px'))
        ], dimension(0, 'em', '0em'))),
        variableDeclaration('from-call', mixinCall('.make', [
          { value: mixinCall('.inner', [dimension(0, 'rem', '0rem')]) }
        ]), { mode: 'declare' }),
        mixinDef('.m', [{ name: 'x', default: dimension(0, 'vh', '0vh') }], [
          decl('inside', dimension(0, 'vw', '0vw'))
        ], guard)
      ], [{ target, partial: false, subject }], guard)
    ]);

    walkAuthoredAst(document, {
      enterNode(_node, cursor) {
        edges.push(cursor.edge);
      },
      enterGuard(_guard, cursor) {
        edges.push(cursor.edge);
      },
      enterSlot(_slot, cursor) {
        edges.push(cursor.edge);
      }
    });

    expect(edges).toContain('declaration.name');
    expect(edges).toContain('ruleset.guard');
    expect(edges).toContain('ruleset.extend.target');
    expect(edges).toContain('ruleset.extend.subject');
    expect(edges).toContain('value.collection.base');
    expect(edges).toContain('value.collection.entry');
    expect(edges).toContain('value.collection.key');
    expect(edges).toContain('value.collection.value');
    expect(edges).toContain('variable.value');
    expect(edges).toContain('mixin-call.arg');
    expect(edges).toContain('mixin.param-default');
    expect(edges).toContain('mixin.guard');
    expect(edges).toContain('guard.cmp.left');
  });
});
