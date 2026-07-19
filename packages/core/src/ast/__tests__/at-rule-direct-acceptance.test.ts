import { describe, expect, it } from 'vitest';
import {
  atRuleBlock,
  atRuleStatement,
  buildEvaluator,
  decl,
  dimension,
  interp,
  keyword,
  root,
  rule,
  sel,
  serialize,
  varDecl,
  varRef,
  type Root
} from '../index.js';
import { makeBuiltinRegistry } from '@jesscss/fns';

const evaluator = buildEvaluator(makeBuiltinRegistry());
const render = (document: Root, collapseNesting = true): string | undefined =>
  serialize(document, { evaluator, collapseNesting }).css;

describe('At-rule canonical AST emission', () => {
  it('evaluates a structured block prelude and its direct canonical body', () => {
    const document = root([
      varDecl('width', dimension(48, 'rem')),
      atRuleBlock('@media', varRef('width'), [
        rule('.card', [decl('display', keyword('grid'))])
      ])
    ]);

    expect(render(document)).toBe(
      '@media 48rem {\n'
      + '  .card {\n'
      + '    display: grid;\n'
      + '  }\n'
      + '}\n'
    );
  });

  it('projects the enclosing selector through a nested conditional at-rule', () => {
    const document = root([
      rule('.card', [
        atRuleBlock('@media', keyword('screen'), [
          rule(sel('&.wide'), [decl('columns', dimension(2))])
        ])
      ])
    ]);

    expect(render(document)).toBe(
      '@media screen {\n'
      + '  .card.wide {\n'
      + '    columns: 2;\n'
      + '  }\n'
      + '}\n'
    );
  });

  it('resolves only structured interpolation in a statement prelude', () => {
    const document = root([
      varDecl('namespace', keyword('svg')),
      atRuleStatement('@namespace', interp([
        { ref: varRef('namespace'), unquote: false },
        { lit: ' "http://www.w3.org/2000/svg"' }
      ]))
    ]);

    expect(render(document)).toBe('@namespace svg "http://www.w3.org/2000/svg";\n');
  });
});
