import { describe, it, expect } from 'vitest';
import { el, compound, sel, co, is, amp, sellist, pseudo } from '../../index.js';
import { selectorCompare } from '../compare.js';
import { matchSelectors } from '../selector-match-core.js';

describe('selectorCompare', () => {
  it('returns true for identical simple selectors', () => {
    const selector = el('.button');
    const result = selectorCompare(selector, el('.button'));
    expect(result.isEquivalent).toBe(true);
    expect(result.hasWholeMatch).toBe(true);
    expect(result.hasPartialMatch).toBe(false);
    expect(result.locations.length).toBeGreaterThanOrEqual(1);
  });

  it('treats compound selectors as order-insensitive equivalents', () => {
    const a = compound([el('.foo'), el('.bar')]);
    const b = compound([el('.bar'), el('.foo')]);
    const result = selectorCompare(a, b);
    expect(result.isEquivalent).toBe(true);
    expect(result.hasPartialMatch).toBe(false);
  });

  it('exposes partial match metadata when selectors differ by a suffix', () => {
    const target = sel([el('.foo'), co('>'), el('.bar')]);
    const shorter = el('.bar');
    const result = selectorCompare(target, shorter);
    expect(result.isEquivalent).toBe(false);
    expect(result.hasPartialMatch).toBe(true);
  });

  it('handles :is() alternatives as expected', () => {
    const list = is(sel([el('.a'), el('.b')]));
    const child = el('.b');
    const result = selectorCompare(list, child);
    expect(result.isEquivalent).toBe(false);
    expect(result.hasPartialMatch).toBe(true);
  });

  it('distinguishes generated vs authored :is()', () => {
    const generated = pseudo({ name: ':is', arg: sellist([el('.x')]) });
    generated.generated = true;
    const authored = pseudo({ name: ':is', arg: sellist([el('.x'), el('.y')]) });
    const result = selectorCompare(generated, authored);
    expect(result.isEquivalent).toBe(false);
    expect(result.hasPartialMatch || result.locations.length > 0).toBe(true);
  });

  it('respects invisible vs visible ampersand context', () => {
    const collapsed = compound([amp(), el('.child')]);
    const visible = compound([el('.parent'), co(' '), el('.child')]);
    const result = selectorCompare(collapsed, visible);
    expect(result.isEquivalent).toBe(false);
  });

  it('handles implicit ampersand selectors', () => {
    const parent = el('.parent');
    const nested = sel([parent, co(' '), el('.child')]);
    const implicitAmp = amp({ selector: parent });
    const implicit = compound([implicitAmp, el('.child')]);
    const result = selectorCompare(nested, implicit);
    expect(Array.isArray(result.locations)).toBe(true);
    expect(result.isEquivalent).toBe(false);
  });

  it('compares selectors with nested :is() chains', () => {
    const complexA = sel([
      el('.foo'),
      co(' '),
      is(
        sellist([
          sel([el('.bar'), co(' '), el('.baz')]),
          pseudo({ name: ':is', arg: sellist([el('.bar')]) })
        ])
      )
    ]);
    const complexB = sel([el('.foo'), co(' '), el('.bar')]);
    const result = selectorCompare(complexA, complexB);
    expect(result.hasPartialMatch).toBe(true);
  });
});

describe('selectorCompare parity with matchSelectors', () => {
  const cases = [
    {
      desc: 'compound order independent',
      target: compound([el('.foo'), el('.bar')]),
      find: compound([el('.bar'), el('.foo')])
    },
    {
      desc: 'partial compound suffix',
      target: sel([el('.foo'), co('>'), el('.bar')]),
      find: el('.bar')
    },
    {
      desc: ':is() alternatives',
      target: is(sellist([el('.alpha'), el('.beta')])),
      find: el('.beta')
    },
    {
      desc: 'implicit ampersand expands to parent selector',
      target: compound([amp({ selector: el('.parent') }), el('.child')]),
      find: sel([el('.parent'), co(' '), el('.child')])
    },
    {
      desc: 'complex :is() chain',
      target: sel([
        el('.foo'),
        co(' '),
        is(
          sellist([
            sel([el('.bar'), co(' '), el('.baz')]),
            pseudo({ name: ':is', arg: sellist([el('.bar')]) })
          ])
        )
      ]),
      find: sel([el('.foo'), co(' '), el('.bar')])
    }
  ];

  cases.forEach(({ desc, target, find }) => {
    it(`matches legacy matchSelectors for ${desc}`, () => {
      const legacy = matchSelectors(target, find);
      const comparison = selectorCompare(target, find);
      expect(comparison.locations.length > 0).toBe(legacy.hasMatch);
      if (comparison.hasWholeMatch) {
        expect(legacy.hasFullMatch).toBe(true);
      }
      if (legacy.hasFullMatch) {
        expect(comparison.hasWholeMatch || comparison.hasPartialMatch).toBe(true);
      }
    });
  });
});
