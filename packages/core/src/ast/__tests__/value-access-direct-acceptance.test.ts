import { describe, expect, it } from 'vitest';
import { makeBuiltinRegistry } from '@jesscss/fns';
import {
  buildEvaluator,
  decl,
  detachedRuleset,
  dimension,
  keyword,
  mapAccessor,
  propRef,
  root,
  rule,
  serialize,
  varDecl,
  varIndirect,
  varRef,
  type Root
} from '../index.js';

const evaluator = buildEvaluator(makeBuiltinRegistry());
const render = (document: Root): string | undefined => serialize(document, { evaluator }).css;

describe('direct canonical value access', () => {
  it('resolves indirect variables, typed map members, and prior property values', () => {
    const tokens = detachedRuleset([
      decl('gap', dimension(8, 'px')),
      varDecl('tone', keyword('navy'))
    ]);
    const document = root([
      varDecl('indirect-name', keyword('width')),
      varDecl('width', dimension(12, 'px')),
      varDecl('tokens', tokens),
      varDecl('member-name', keyword('tone')),
      rule('.card', [
        decl('width', varIndirect(varRef('indirect-name'))),
        decl('gap', mapAccessor(varRef('tokens'), keyword('gap'), 'prop', '@tokens[gap]')),
        decl('color', mapAccessor(varRef('tokens'), varRef('member-name'), 'var', '@tokens[@member-name]')),
        decl('min-width', propRef('width'))
      ])
    ]);

    expect(render(document)).toBe(
      '.card {\n'
      + '  width: 12px;\n'
      + '  gap: 8px;\n'
      + '  color: navy;\n'
      + '  min-width: 12px;\n'
      + '}\n'
    );
  });

  it('propagates importance through a direct property accessor exactly once', () => {
    const document = root([
      rule('.card', [
        decl('color', keyword('red'), null, true),
        decl('background', propRef('color'))
      ])
    ]);

    expect(render(document)).toBe('.card {\n  color: red !important;\n  background: red !important;\n}\n');
  });

  it('carries a property accessor importance signal through a declaration merge', () => {
    const document = root([
      rule('.card', [
        decl('tone', keyword('navy'), null, true),
        decl('shadow', propRef('tone'), ','),
        decl('shadow', keyword('black'), ',')
      ])
    ]);

    expect(render(document)).toBe('.card {\n  tone: navy !important;\n  shadow: navy, black !important;\n}\n');
  });

  it('resets a property-accessor importance signal before a later merge group and plain declaration', () => {
    const document = root([
      rule('.card', [
        decl('tone', keyword('navy'), null, true),
        decl('shadow', propRef('tone'), ','),
        decl('shadow', keyword('black'), ','),
        decl('outline', keyword('solid'), ','),
        decl('outline', keyword('transparent'), ','),
        decl('background', keyword('white'))
      ])
    ]);

    expect(render(document)).toBe(
      '.card {\n'
      + '  tone: navy !important;\n'
      + '  shadow: navy, black !important;\n'
      + '  outline: solid, transparent;\n'
      + '  background: white;\n'
      + '}\n'
    );
  });
});
