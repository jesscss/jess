import { describe, expect, it } from 'vitest';
import { makeBuiltinRegistry } from '@jesscss/fns';
import { atRuleBlock } from '../at-rule.js';
import { buildEvaluator } from '../evaluator.js';
import {
  complex, compoundOf, decl, interp, keyword, root, rule, sel, selist, simple, simpleInterp, varDecl, varRef, type Root
} from '../nodes.js';
import { serialize } from '../serialize.js';

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

  it('grafts a partial match without any parser or host-built selector state', () => {
    const document = root([
      rule(complex([{ compound: compoundOf([simple('.error'), simple('.intrusion')]) }]), [decl('color', keyword('red'))]),
      rule('.bad-error', [], [{ target: selist(sel('.error')), partial: true }])
    ]);

    expect(render(document)).toBe(
      ':is(.error, .bad-error).intrusion {\n'
      + '  color: red;\n'
      + '}\n'
    );
  });

  it('keeps a nested extender and its descendant in the candidate cascade', () => {
    const document = root([
      rule('.target', [
        decl('color', keyword('red')),
        rule('.child', [decl('color', keyword('blue'))])
      ]),
      rule('.outer', [
        rule('.inner', [], [{ target: selist(sel('.target')), partial: true }])
      ])
    ]);

    expect(render(document)).toBe(
      '.target,\n'
      + '.outer .inner {\n'
      + '  color: red;\n'
      + '}\n'
      + ':is(.target, .outer .inner) .child {\n'
      + '  color: blue;\n'
      + '}\n'
    );
  });

  it('limits a direct media-scoped extender to that scope', () => {
    const document = root([
      rule('.target', [decl('color', keyword('black'))]),
      atRuleBlock('@media', keyword('screen'), [
        rule('.target', [decl('color', keyword('red'))]),
        rule('.replacement', [], [{ target: selist(sel('.target')), partial: false }])
      ])
    ]);

    expect(render(document)).toBe(
      '.target {\n'
      + '  color: black;\n'
      + '}\n'
      + '@media screen {\n'
      + '  .target,\n'
      + '  .replacement {\n'
      + '    color: red;\n'
      + '  }\n'
      + '}\n'
    );
  });

  it('resolves an interpolated direct-AST extender before candidate selection', () => {
    const interpolated = complex([{ compound: compoundOf([simpleInterp(interp([{ ref: varRef('name'), unquote: false }]))]) }]);
    const document = root([
      varDecl('name', keyword('.replacement')),
      rule('.target', [decl('color', keyword('red'))]),
      rule(interpolated, [], [{ target: selist(sel('.target')), partial: true }])
    ]);

    expect(render(document)).toBe(
      '.target,\n'
      + '.replacement {\n'
      + '  color: red;\n'
      + '}\n'
    );
  });
});
