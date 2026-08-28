import { describe, expect, it } from 'vitest';
import { buildEvaluator } from '../evaluator.js';
import {
  decl, reference, anonymousMixin, dimension, ifValue, keyword,
  mixinCall, mixinDef, stylesheet, rule, variableDeclaration, variableReference, type Stylesheet
} from '../nodes.js';
import { serialize } from '../serialize.js';
import { makeLessRegistry } from '@jesscss/fns';

const evaluator = buildEvaluator(makeLessRegistry());
const render = (document: Stylesheet): string | undefined => serialize(document, { evaluator }).css;

describe('variable-call canonical AST emission', () => {
  it('splices a direct detached ruleset through its definition scope and caller fallback', () => {
    const document = stylesheet([
      variableDeclaration('base', keyword('red'), { mode: 'declare' }),
      variableDeclaration('theme', anonymousMixin([
        variableDeclaration('local', variableReference('base', 'scoped'), { mode: 'declare' }),
        decl('color', variableReference('local', 'scoped')),
        decl('width', variableReference('caller-width', 'scoped'))
      ]), { mode: 'declare' }),
      rule('.card', [
        variableDeclaration('base', keyword('blue'), { mode: 'declare' }),
        variableDeclaration('caller-width', dimension(24, 'px'), { mode: 'declare' }),
        reference(variableReference('theme', 'scoped'), [{ type: 'Call', args: [] }], '@theme()')
      ])
    ]);

    expect(render(document)).toBe('.card {\n  color: red;\n  width: 24px;\n}\n');
  });

  it('selects a conditional detached-ruleset branch without materializing it as a value', () => {
    const document = stylesheet([
      variableDeclaration('enabled', keyword('true'), { mode: 'declare' }),
      variableDeclaration('content', ifValue([
        {
          guard: { g: 'truth', value: variableReference('enabled', 'scoped') },
          value: anonymousMixin([decl('display', keyword('grid'))])
        },
        { guard: null, value: anonymousMixin([decl('display', keyword('none'))]) }
      ]), { mode: 'declare' }),
      rule('.panel', [reference(variableReference('content', 'scoped'), [{ type: 'Call', args: [] }], '@content()')])
    ]);

    expect(render(document)).toBe('.panel {\n  display: grid;\n}\n');
  });

  it('retains a detached mixin argument\'s caller closure over a same-named mixin local', () => {
    const document = stylesheet([
      variableDeclaration('a', dimension(1, 'px'), { mode: 'declare' }),
      mixinDef('.wrap', [{ name: 'ruleset' }], [
        variableDeclaration('a', keyword('hidden'), { mode: 'declare' }),
        rule('.inner', [reference(variableReference('ruleset', 'scoped'), [{ type: 'Call', args: [] }], '@ruleset()')])
      ]),
      rule('.entry', [
        mixinCall('.wrap', [anonymousMixin([decl('width', variableReference('a', 'scoped'))])])
      ])
    ]);

    expect(render(document)).toBe('.entry .inner {\n  width: 1px;\n}\n');
  });
});
