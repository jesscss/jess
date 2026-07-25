import { describe, expect, it } from 'vitest';
import { atRuleBlock, atRuleStatement } from '../at-rule.js';
import { buildEvaluator } from '../evaluator.js';
import {
  decl, dimension, generalEnclosed, interpolation, keyword, spaced, stylesheet, rule, sel, variableDeclaration, variableReference, type Stylesheet
} from '../nodes.js';
import { serialize } from '../serialize.js';
import { makeLessRegistry } from '@jesscss/fns';

const evaluator = buildEvaluator(makeLessRegistry());
const render = (document: Stylesheet, collapseNesting = true): string | undefined =>
  serialize(document, { evaluator, collapseNesting }).css;

describe('At-rule canonical AST emission', () => {
  it('evaluates a structured block prelude and its direct canonical body', () => {
    const document = stylesheet([
      variableDeclaration('width', dimension(48, 'rem'), { mode: 'declare' }),
      atRuleBlock('@media', variableReference('width', 'scoped'), [
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
    const document = stylesheet([
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
    const document = stylesheet([
      variableDeclaration('namespace', keyword('svg'), { mode: 'declare' }),
      atRuleStatement('@namespace', interpolation([
        { ref: variableReference('namespace', 'scoped'), unquote: false },
        { lit: ' "http://www.w3.org/2000/svg"' }
      ]))
    ]);

    expect(render(document)).toBe('@namespace svg "http://www.w3.org/2000/svg";\n');
  });

  it('renders general-enclosed supports syntax inertly without normalizing its content', () => {
    const document = stylesheet([
      atRuleBlock('@supports', spaced([
        generalEnclosed('function', 'selector', interpolation([{ lit: '  .card /* keep  */ ' }])),
        keyword('and'),
        generalEnclosed('paren', null, interpolation([{ lit: ' font-tech(  color-COLRv1  ) ' }]))
      ]), [rule('.card', [decl('display', keyword('grid'))])])
    ]);

    expect(render(document)).toBe(
      '@supports selector(  .card /* keep  */ ) and ( font-tech(  color-COLRv1  ) ) {\n'
      + '  .card {\n'
      + '    display: grid;\n'
      + '  }\n'
      + '}\n'
    );
  });

  it('preserves authored private-use bytes inside general-enclosed content', () => {
    const document = stylesheet([
      atRuleBlock('@supports', generalEnclosed('function', 'selector', interpolation([
        { lit: '\uE000  .card\uE001 ' }
      ])), [rule('.card', [decl('display', keyword('grid'))])])
    ]);

    expect(render(document)).toContain('@supports selector(\uE000  .card\uE001 )');
  });

  it('resolves general-enclosed interpolation without treating its name as a call', () => {
    const document = stylesheet([
      variableDeclaration('feature', keyword('.card'), { mode: 'declare' }),
      atRuleBlock('@supports', generalEnclosed('function', 'selector', interpolation([
        { lit: ':is(' }, { ref: variableReference('feature', 'scoped'), unquote: false }, { lit: ')' }
      ])), [rule('.card', [decl('display', keyword('grid'))])])
    ]);

    expect(render(document)).toContain('@supports selector(:is(.card))');
  });
});
