import { describe, expect, it } from 'vitest';
import { makeBuiltinRegistry } from '@jesscss/fns';
import { atRuleBlock } from '../at-rule.js';
import { buildEvaluator } from '../evaluator.js';
import {
  compoundSelectorOf, complexHasAmpersand, complexSelector, decl, interpolation, keyword, pseudoSelector, stylesheet, rule, sel, selist, simpleSelector, interpolatedSimpleSelector, variableDeclaration, variableReference, type Stylesheet
} from '../nodes.js';
import { serialize } from '../serialize.js';
import { collectPlan } from '../extend/plan.js';

const evaluator = buildEvaluator(makeBuiltinRegistry());
const render = (document: Stylesheet, collapseNesting = true): string | undefined =>
  serialize(document, { evaluator, collapseNesting }).css;

describe('direct canonical extend', () => {
  it('ingests an over-limit imported planner overlay without turning it into call arguments', () => {
    const overlaySource = stylesheet([rule('.imported', [])]);
    const overlaySubject = collectPlan(overlaySource).subjects[0]!;
    const overlay = {
      subjects: new Array(150_000).fill(overlaySubject),
      instructions: []
    };
    const plan = collectPlan(stylesheet([rule('.root', [])]), undefined, undefined, overlay);

    expect(plan.subjects).toHaveLength(150_001);
    expect(plan.subjects[0]!.rule.selector).toEqual(selist(sel('.root')));
    expect(plan.subjects.at(-1)).toBe(overlaySubject);
  });

  it('adds an exact extender to its target rule header', () => {
    const document = stylesheet([
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

  it('crosses a structured :is() to append an exact extender whose find dot-matches one arm (C1)', () => {
    // `.x:is(.a, .b) { … } .y:extend(.x.a) {}` — the crossable `:is()` graft lets the
    // find `.x.a` match through the `.a` arm, so `.y` appends as a whole-branch comma
    // sibling. The base header serializes byte-identically (`:is(.a, .b)`).
    const base = complexSelector([{
      compound: compoundSelectorOf([simpleSelector('.x'), pseudoSelector(':is', selist(sel('.a'), sel('.b')))])
    }]);
    const find = complexSelector([{
      compound: compoundSelectorOf([simpleSelector('.x'), simpleSelector('.a')])
    }]);
    const document = stylesheet([
      rule(base, [decl('c', keyword('d'))]),
      rule('.y', [], [{ target: selist(find), partial: false }])
    ]);

    expect(render(document)).toBe(
      '.x:is(.a, .b),\n'
      + '.y {\n'
      + '  c: d;\n'
      + '}\n'
    );
  });

  it('crosses a structured :is() alongside a trailing simple (C4)', () => {
    // `.x:is(.a, .b).c { … } .y:extend(.x.a.c) {}` — the find `.x.a.c` matches through
    // the `.a` arm while `.x`/`.c` match the bare simples on either side of the graft.
    const base = complexSelector([{
      compound: compoundSelectorOf([simpleSelector('.x'), pseudoSelector(':is', selist(sel('.a'), sel('.b'))), simpleSelector('.c')])
    }]);
    const find = complexSelector([{
      compound: compoundSelectorOf([simpleSelector('.x'), simpleSelector('.a'), simpleSelector('.c')])
    }]);
    const document = stylesheet([
      rule(base, [decl('c', keyword('d'))]),
      rule('.y', [], [{ target: selist(find), partial: false }])
    ]);

    expect(render(document)).toBe(
      '.x:is(.a, .b).c,\n'
      + '.y {\n'
      + '  c: d;\n'
      + '}\n'
    );
  });

  it('adds an exact extender whose target reorders the compound simples', () => {
    // `.b.c {}` + `.a:extend(.c.b) {}` — the find `.c.b` is compound-equivalent to
    // the base `.b.c` (order of simple selectors is irrelevant, EXTEND_RULES §0), so
    // it is a WHOLE-branch exact match and `.a` appends as a sibling.
    const base = complexSelector([{ compound: compoundSelectorOf([simpleSelector('.b'), simpleSelector('.c')]) }]);
    const find = complexSelector([{ compound: compoundSelectorOf([simpleSelector('.c'), simpleSelector('.b')]) }]);
    const document = stylesheet([
      rule(base, [decl('color', keyword('red'))]),
      rule('.a', [], [{ target: selist(find), partial: false }])
    ]);

    expect(render(document)).toBe(
      '.b.c,\n'
      + '.a {\n'
      + '  color: red;\n'
      + '}\n'
    );
  });

  it('propagates an all extender through a nested target selector', () => {
    const document = stylesheet([
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
    const document = stylesheet([
      rule(complexSelector([{ compound: compoundSelectorOf([simpleSelector('.error'), simpleSelector('.intrusion')]) }]), [decl('color', keyword('red'))]),
      rule('.bad-error', [], [{ target: selist(sel('.error')), partial: true }])
    ]);

    expect(render(document)).toBe(
      ':is(.error, .bad-error).intrusion {\n'
      + '  color: red;\n'
      + '}\n'
    );
  });

  it('keeps a nested extender and its descendant in the candidate cascade', () => {
    const document = stylesheet([
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
    const document = stylesheet([
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

  it('activates a prior live declaration before resolving an interpolated extender', () => {
    const interpolated = complexSelector([{ compound: compoundSelectorOf([interpolatedSimpleSelector(interpolation([{ ref: variableReference('name', 'live'), unquote: false }]))]) }]);
    const document = stylesheet([
      variableDeclaration('name', keyword('.replacement'), { mode: 'declare' }),
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

  it('composes literal ampersands inside an interpolated selector token over every parent', () => {
    const child = complexSelector([{
      compound: compoundSelectorOf([
        interpolatedSimpleSelector(interpolation([
          { lit: '&-' },
          { ref: variableReference('suffix', 'scoped'), unquote: true }
        ]))
      ])
    }]);
    const document = stylesheet([
      variableDeclaration('suffix', keyword('active'), { mode: 'declare' }),
      rule(selist(sel('.button'), sel('.link')), [rule(child, [decl('color', keyword('red'))])])
    ]);

    expect(complexHasAmpersand(child)).toBe(true);
    expect(render(document)).toBe(
      '.button-active,\n'
      + '.link-active {\n'
      + '  color: red;\n'
      + '}\n'
    );
  });

  it('preserves a literal interpolated parent marker through the extend prepass', () => {
    const child = complexSelector([{
      compound: compoundSelectorOf([
        interpolatedSimpleSelector(interpolation([
          { lit: '&-' },
          { ref: variableReference('suffix', 'scoped'), unquote: true }
        ]))
      ])
    }]);
    const document = stylesheet([
      variableDeclaration('suffix', keyword('active'), { mode: 'declare' }),
      rule('.target', [decl('color', keyword('black'))]),
      rule('.replacement', [], [{ target: selist(sel('.target')), partial: false }]),
      rule('.button', [rule(child, [decl('color', keyword('red'))])])
    ]);

    expect(complexHasAmpersand(child)).toBe(true);
    expect(render(document)).toBe(
      '.target,\n'
      + '.replacement {\n'
      + '  color: black;\n'
      + '}\n'
      + '.button-active {\n'
      + '  color: red;\n'
      + '}\n'
    );
    expect(complexHasAmpersand(child)).toBe(true);
  });

  it('keeps a resolved ampersand reference as an ordinary selector with or without the extend prepass', () => {
    const child = complexSelector([{
      compound: compoundSelectorOf([
        interpolatedSimpleSelector(interpolation([{ ref: variableReference('selector', 'scoped'), unquote: true }]))
      ])
    }]);
    const withoutExtend = stylesheet([
      variableDeclaration('selector', keyword('&-active'), { mode: 'declare' }),
      rule('.button', [rule(child, [decl('color', keyword('red'))])])
    ]);
    expect(complexHasAmpersand(child)).toBe(false);
    expect(render(withoutExtend)).toBe(
      '.button &-active {\n'
      + '  color: red;\n'
      + '}\n'
    );

    const prepassChild = complexSelector([{
      compound: compoundSelectorOf([
        interpolatedSimpleSelector(interpolation([{ ref: variableReference('selector', 'scoped'), unquote: true }]))
      ])
    }]);
    const withExtend = stylesheet([
      variableDeclaration('selector', keyword('&-active'), { mode: 'declare' }),
      rule('.target', [decl('color', keyword('black'))]),
      rule('.replacement', [], [{ target: selist(sel('.target')), partial: false }]),
      rule('.button', [rule(prepassChild, [decl('color', keyword('red'))])])
    ]);

    expect(complexHasAmpersand(prepassChild)).toBe(false);
    expect(render(withExtend)).toBe(
      '.target,\n'
      + '.replacement {\n'
      + '  color: black;\n'
      + '}\n'
      + '.button &-active {\n'
      + '  color: red;\n'
      + '}\n'
    );
    expect(complexHasAmpersand(prepassChild)).toBe(false);
  });
});
