import { describe, it, expect } from 'vitest';
import { el, sel, sellist, compound, co, pseudo, attr, PseudoSelector, amp, rules, ruleset, any } from '../../index.js';
import { processLeadingIs } from '../process-leading-is.js';
import { isNode } from '../is-node.js';
import { N } from '../../node-type.js';
import type { Selector } from '../../selector.js';
import { Context } from '../../../context.js';
import { F_IMPLICIT_AMPERSAND } from '../../node.js';

/** PseudoSelector.create (Node.create) sets generated so processLeadingIs can unwrap. */
function generatedIs(selector: Selector) {
  const p = (PseudoSelector as any).create({ name: ':is', arg: selector as any });
  expect(p.generated, 'PseudoSelector.create must set generated').toBe(true);
  return p as ReturnType<typeof pseudo>;
}

/** Stringify processLeadingIs result for toBeString comparison */
function out(result: Selector | Selector[]): string {
  return Array.isArray(result) ? result.map(s => (s as Selector).valueOf()).join(', ') : (result as Selector).valueOf();
}

describe('processLeadingIs', () => {
  describe('does not unwrap when :is is not generated', () => {
    it('leaves non-generated :is(SelectorList) as-is', () => {
      const list = sellist([el('.a'), el('.b')]);
      const isPseudo = pseudo({ name: ':is', arg: list });
      expect((isPseudo).generated).toBeFalsy();
      const result = processLeadingIs(isPseudo);
      expect(result).toBe(isPseudo);
      expect(out(result as Selector)).toBeString(`:is(.a,.b)`);
    });

    it('leaves non-generated :is(simple) as-is', () => {
      const isPseudo = pseudo({ name: ':is', arg: el('.x') });
      const result = processLeadingIs(isPseudo);
      expect(result).toBe(isPseudo);
      expect(out(result as Selector)).toBeString(`:is(.x)`);
    });
  });

  describe('single generated :is()', () => {
    it('unwraps generated :is(simple) to the inner selector', () => {
      const inner = el('.x');
      const isPseudo = generatedIs(inner);
      const result = processLeadingIs(isPseudo);
      expect(Array.isArray(result)).toBe(false);
      expect(out(result as Selector)).toBeString(`.x`);
    });

    it('unwraps generated :is(SelectorList) at top level to SelectorList when multiple items', () => {
      const list = sellist([el('.a'), el('.b')]);
      const isPseudo = generatedIs(list);
      const result = processLeadingIs(isPseudo);
      expect(Array.isArray(result)).toBe(false);
      expect(out(result as Selector)).toBeString(`.a,.b`);
    });

    it('unwraps generated :is(SelectorList) at top level to single selector when one item', () => {
      const list = sellist([el('.a')]);
      const isPseudo = generatedIs(list);
      const result = processLeadingIs(isPseudo);
      expect(Array.isArray(result)).toBe(false);
      expect(out(result as Selector)).toBeString(`.a`);
    });

    it('returns array when inSelectorList and generated :is(SelectorList)', () => {
      const list = sellist([el('.a'), el('.b')]);
      const isPseudo = generatedIs(list);
      const result = processLeadingIs(isPseudo, { inSelectorList: true });
      expect(Array.isArray(result)).toBe(true);
      expect(out(result as Selector[])).toBeString(`.a, .b`);
    });
  });

  describe('SelectorList', () => {
    it('flattens list items that are generated :is(SelectorList) when inSelectorList', () => {
      const item1 = el('.x');
      const item2 = generatedIs(sellist([el('.a'), el('.b')]));
      const list = sellist([item1, item2]);
      const result = processLeadingIs(list, { inSelectorList: false });
      expect(out(result as Selector)).toBeString(`.x,.a,.b`);
    });

    it('returns single selector when list has one item after processing', () => {
      const inner = el('.only');
      const isPseudo = generatedIs(inner);
      const list = sellist([isPseudo]);
      const result = processLeadingIs(list);
      expect(Array.isArray(result)).toBe(false);
      expect(out(result as Selector)).toBeString(`.only`);
    });
  });

  describe('CompoundSelector with generated :is as first component', () => {
    /**
     * Same initial AST as Less/CSS parser for `* b { &[e] { } }`:
     * - Parser: qualifiedRule → selectorList → (single) complexSelector for `* b` → [BasicSelector(*), Combinator(' '), BasicSelector(b)].
     *   selectorList returns the single item, so ruleset.selector = ComplexSelector (not SelectorList).
     * - Parser: inner qualifiedRule → selectorList → (single) complexSelector for `&[e]` → compoundSelector → [Ampersand, AttributeSelector(e)].
     *   compoundSelector with 2 items returns CompoundSelector; complexSelector returns it; selectorList returns it.
     * So we build the same: frame selector = sel([el('*'), co(' '), el('b')]) (ComplexSelector), inner = compound([amp(), attr({ name: 'e' })]) (CompoundSelector).
     * Eval produces compound with first component :is(* b); ampersand sets .generated so processLeadingIs unwraps to * b[e].
     */
    it('unwraps evaled &[e] with frame * b to * b[e] (same path as ruleset)', async () => {
      const parentSelector = sel([el('*'), co(' '), el('b')]) as any;
      const frameRuleset = ruleset({ selector: parentSelector, rules: rules([]) });
      const innerSelector = compound([amp(), attr({ name: 'e' })]);
      const context = new Context({ collapseNesting: true });
      context.rulesetFrames.push(frameRuleset);
      const evaled = await (innerSelector as any).eval(context);
      expect(isNode(evaled, N.CompoundSelector)).toBe(true);
      const first = (evaled as any).value[0];
      expect(isNode(first, N.PseudoSelector)).toBe(true);
      expect((first as PseudoSelector).generated, 'ampersand path must set .generated so processLeadingIs unwraps').toBe(true);
      const result = processLeadingIs(evaled as Selector);
      expect(out(result as Selector)).toBeString(`* b[e]`);
    });

    it('unwraps :is(complex) and merges suffix into last part of complex', () => {
      const complex = sel([el('.menu'), co(' '), el('.menu')]);
      const comp = compound([generatedIs(complex as any), el('li')]);
      const result = processLeadingIs(comp);
      expect(out(result as Selector)).toBeString(`.menu li.menu`);
    });

    it('unwraps :is(* b)[e] to * b[e] (complex parent + attribute suffix; css-3 nesting case)', () => {
      const complex = sel([el('*'), co(' '), el('b')]);
      const comp = compound([generatedIs(complex as any), attr({ name: 'e' })]);
      const result = processLeadingIs(comp);
      expect(out(result as Selector)).toBeString(`* b[e]`);
    });

    it('does not unwrap when :is arg is SelectorList', () => {
      const list = sellist([el('.a'), el('.b')]);
      const comp = compound([generatedIs(list), el('li')]);
      const result = processLeadingIs(comp);
      expect(result).toBe(comp);
      expect(out(result as Selector)).toBeString(`li:is(.a,.b)`);
    });
  });

  describe('ComplexSelector with generated :is as first visual component', () => {
    it('unwraps :is(ComplexSelector) into complex components', () => {
      const inner = sel([el('.menu'), co(' '), el('.menu')]);
      const complex = sel([generatedIs(inner as any), co(' '), el('.menu'), co('>'), el('li')]);
      const result = processLeadingIs(complex as any);
      expect(out(result as Selector)).toBeString(`.menu .menu .menu>li`);
    });

    it('unwraps :is(simple) as first component to single selector + rest', () => {
      const inner = el('.x');
      const complex = sel([generatedIs(inner), co(' '), el('.y')]);
      const result = processLeadingIs(complex as any);
      expect(out(result as Selector)).toBeString(`.x .y`);
    });

    it('does not unwrap when :is arg is SelectorList', () => {
      const list = sellist([el('.a'), el('.b')]);
      const complex = sel([generatedIs(list), co(' '), el('.y')]);
      const result = processLeadingIs(complex as any);
      expect(result).toBe(complex);
      expect(out(result as Selector)).toBeString(`:is(.a,.b) .y`);
    });
  });

  describe('implicit ampersand + generated :is(SelectorList)', () => {
    it('unwraps to selector list when shape is implicit-& + generated :is(list)', () => {
      const ampNode = amp({ selectorContainer: { selector: el('.base') } });
      (ampNode as any).addFlag(F_IMPLICIT_AMPERSAND);
      const listArg = sellist([
        sel([el('.base'), co(' '), el('.x')]),
        sel([el('.base'), co(' '), el('.y')])
      ]);
      const selector = sel([ampNode, co(' '), generatedIs(listArg)]);
      const result = processLeadingIs(selector as any);
      expect(Array.isArray(result)).toBe(false);
      expect(out(result as Selector)).toBeString(`.x,.y`);
    });

    it('removes generated :is(list) wrapper in non-header special case', () => {
      const ampNode = amp({ selectorContainer: { selector: el('.base') } });
      (ampNode as any).addFlag(F_IMPLICIT_AMPERSAND);
      const listArg = sellist([
        sel([el('.base'), co(' '), el('.x')]),
        sel([el('.base'), co(' '), el('.y')])
      ]);
      const selector = sel([ampNode, co(' '), generatedIs(listArg), co(' '), el('.tail')]);
      const result = processLeadingIs(selector as any);
      expect(Array.isArray(result)).toBe(false);
      expect(out(result as Selector)).not.toContain(':is(');
      expect(out(result as Selector)).toContain('.tail');
    });
  });

  describe('does not recurse into pseudo args', () => {
    it('unwraps outer generated :is once; inner :is is returned as arg (not recursively unwrapped)', () => {
      const innerIs = pseudo({ name: ':is', arg: el('.inner') });
      innerIs.generated = true;
      const outer = generatedIs(innerIs);
      const result = processLeadingIs(outer);
      expect(Array.isArray(result)).toBe(false);
      expect(out(result as Selector)).toBeString(`:is(.inner)`);
    });
  });
});
