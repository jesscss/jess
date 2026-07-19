import { describe, expect, it } from 'vitest';
import { makeBuiltinRegistry } from '@jesscss/fns';
import {
  buildEvaluator,
  decl,
  keyword,
  root,
  rule,
  sel,
  selist,
  serialize,
  type Root
} from '../index.js';

const evaluator = buildEvaluator(makeBuiltinRegistry());
const render = (document: Root, collapseNesting = true): string | undefined =>
  serialize(document, { evaluator, collapseNesting }).css;

describe('direct canonical extend', () => {
  it('adds an exact extender to its target rule header', () => {
    const document = root([
      rule('.button', [decl('color', keyword('navy'))]),
      rule('.button-primary', [], [{ target: selist(sel('.button')), partial: false }])
    ]);

    expect(render(document)).toBe(
      '.button,\n'
      + '.button-primary {\n'
      + '  color: navy;\n'
      + '}\n'
    );
  });

  it('propagates an all extender through a nested target selector', () => {
    const document = root([
      rule('.button', [
        decl('color', keyword('navy')),
        rule('.icon', [decl('fill', keyword('currentColor'))])
      ]),
      rule('.button-primary', [], [{ target: selist(sel('.button')), partial: true }])
    ]);

    expect(render(document)).toBe(
      '.button,\n'
      + '.button-primary {\n'
      + '  color: navy;\n'
      + '}\n'
      + ':is(.button, .button-primary) .icon {\n'
      + '  fill: currentColor;\n'
      + '}\n'
    );
  });
});
