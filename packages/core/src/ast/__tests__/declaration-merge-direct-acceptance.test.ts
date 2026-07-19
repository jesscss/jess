import { describe, expect, it } from 'vitest';
import { makeBuiltinRegistry } from '@jesscss/fns';
import {
  buildEvaluator,
  decl,
  important,
  keyword,
  root,
  rule,
  serialize,
  varDecl,
  varRef,
  type Root
} from '../index.js';

const evaluator = buildEvaluator(makeBuiltinRegistry());
const render = (document: Root): string | undefined => serialize(document, { evaluator }).css;

describe('direct canonical declaration merge', () => {
  it('promotes an important value from any comma-merge member exactly once', () => {
    const document = root([
      varDecl('accent', important(keyword('navy'))),
      rule('.card', [
        decl('box-shadow', varRef('accent'), ','),
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
    const document = root([
      varDecl('accent', important(keyword('navy'))),
      rule('.card', [
        decl('box-shadow', varRef('accent'), ','),
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
