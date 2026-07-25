import { describe, expect, it } from 'vitest';
import { makeLessRegistry } from '@jesscss/fns';
import { buildEvaluator } from '../evaluator.js';
import { decl, important, keyword, stylesheet, rule, variableDeclaration, variableReference, type Stylesheet } from '../nodes.js';
import { serialize } from '../serialize.js';

const evaluator = buildEvaluator(makeLessRegistry());
const render = (document: Stylesheet): string | undefined => serialize(document, { evaluator }).css;

describe('direct canonical declaration merge', () => {
  it('promotes an important value from any comma-merge member exactly once', () => {
    const document = stylesheet([
      variableDeclaration('accent', important(keyword('navy')), { mode: 'declare' }),
      rule('.card', [
        decl('box-shadow', variableReference('accent', 'scoped'), ','),
        decl('box-shadow', keyword('white'), ',')
      ])
    ]);

    expect(render(document)).toBe(
      '.card {\n'
      + '  box-shadow: navy, white !important;\n'
      + '}\n'
    );
  });

  it('resets an important merge member before later merge groups and plain declarations', () => {
    const document = stylesheet([
      variableDeclaration('accent', important(keyword('navy')), { mode: 'declare' }),
      rule('.card', [
        decl('box-shadow', variableReference('accent', 'scoped'), ','),
        decl('box-shadow', keyword('white'), ','),
        decl('background', keyword('black'), ','),
        decl('background', keyword('gray'), ','),
        decl('color', keyword('teal'))
      ])
    ]);

    expect(render(document)).toBe(
      '.card {\n'
      + '  box-shadow: navy, white !important;\n'
      + '  background: black, gray;\n'
      + '  color: teal;\n'
      + '}\n'
    );
  });
});
