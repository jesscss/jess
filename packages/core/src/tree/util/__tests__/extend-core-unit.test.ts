import { describe, expect, it } from 'vitest';
import { amp, co, compound, el, is, pseudo, sel, sellist } from '../../../index.js';
import { ExtendErrorType, tryExtendSelector } from '../extend-core.js';

function serialize(selector: { toString(): string }) {
  return selector.toString().trim().replace(/\s*,\s*/g, ', ');
}

describe('tryExtendSelector', () => {
  it('returns success result for an exact matching extend', () => {
    const target = el('.a');
    const result = tryExtendSelector(target, el('.a'), el('.b'), false);

    expect(result.error).toBeUndefined();
    expect(serialize(result.value)).toBe('.a, .b');
  });

  it('returns NOT_FOUND when an exact extend does not match', () => {
    const target = el('.a');
    const result = tryExtendSelector(target, el('.z'), el('.b'), false);

    expect(result.value).toBe(target);
    expect(result.error?.type).toBe(ExtendErrorType.NOT_FOUND);
  });

  it('appends an exact match into an existing selector list', () => {
    const target = sellist([el('.a'), el('.b')]);
    const result = tryExtendSelector(target, el('.a'), el('.c'), false);

    expect(result.error).toBeUndefined();
    expect(result.value).toBe(target);
    expect(serialize(result.value)).toBe('.a, .b, .c');
  });

  it('appends an exact match into a sole :is() selector', () => {
    const target = is(sellist([el('.a'), el('.b')]));
    const result = tryExtendSelector(target, el('.a'), el('.c'), false);

    expect(result.error).toBeUndefined();
    expect(result.value).toBe(target);
    expect(serialize(result.value)).toBe(':is(.a, .b, .c)');
  });

  it('resolves a crossed leading ampersand before exact extend output', () => {
    const parent = el('.parent');
    const target = sel([amp(), co(' '), el('.child')]);
    const find = sel([el('.parent'), co(' '), el('.child')]);
    const result = tryExtendSelector(target, find, el('.other'), false, parent);

    expect(result.error).toBeUndefined();
    expect(result.value.hoistToRoot).toBeFalsy();
    expect(serialize(result.value)).toBe('.parent .child, .other');
  });

  it('wraps a selector-list parent before exact extend output', () => {
    const parent = sellist([el('div'), el('span')]);
    const target = sel([amp(), co(' '), el('.child')]);
    const find = sel([el('span'), co(' '), el('.child')]);
    const result = tryExtendSelector(target, find, el('.other'), false, parent);

    expect(result.error).toBeUndefined();
    expect(result.value.hoistToRoot).toBeFalsy();
    expect(serialize(result.value)).toBe(':is(div, span) .child, .other');
  });

  it('splices in a leading complex parent before exact extend output', () => {
    const parent = sel([el('.grand'), co('>'), el('.parent')]);
    const target = sel([amp(), co(' '), el('.child')]);
    const find = sel([el('.grand'), co('>'), el('.parent'), co(' '), el('.child')]);
    const result = tryExtendSelector(target, find, el('.other'), false, parent);

    expect(result.error).toBeUndefined();
    expect(result.value.hoistToRoot).toBeFalsy();
    expect(serialize(result.value)).toBe('.grand > .parent .child, .other');
  });

  it('wraps a non-leading complex parent before exact extend output', () => {
    const parent = sel([el('.grand'), co('>'), el('.parent')]);
    const target = sel([el('.prefix'), co(' '), amp({ selectorContainer: { selector: parent } })]);
    const find = sel([el('.prefix'), co(' '), el('.grand'), co('>'), el('.parent')]);
    const result = tryExtendSelector(target, find, el('.other'), false, parent);

    expect(result.error).toBeUndefined();
    expect(result.value.hoistToRoot).toBeFalsy();
    expect(serialize(result.value)).toBe('.prefix :is(.grand > .parent), .other');
  });

  it('splices in a non-leading simple parent before exact extend output', () => {
    const parent = el('.parent');
    const target = sel([el('.prefix'), co(' '), amp()]);
    const find = sel([el('.prefix'), co(' '), el('.parent')]);
    const result = tryExtendSelector(target, find, el('.other'), false, parent);

    expect(result.error).toBeUndefined();
    expect(result.value.hoistToRoot).toBeFalsy();
    expect(serialize(result.value)).toBe('.prefix .parent, .other');
  });

  it('wraps a simple partial match in :is()', () => {
    const target = sel([el('.a'), co('>'), el('.b')]);
    const result = tryExtendSelector(target, el('.b'), el('.c'), true);

    expect(result.error).toBeUndefined();
    expect(result.value).toBe(target);
    expect(serialize(result.value)).toBe('.a > :is(.b, .c)');
  });

  it('wraps a compound-local partial match in :is()', () => {
    const target = sel([el('.a'), co('>'), compound([el('.b'), el('.c')])]);
    const result = tryExtendSelector(target, el('.b'), el('.d'), true);

    expect(result.error).toBeUndefined();
    expect(result.value).toBe(target);
    expect(serialize(result.value)).toBe('.a > :is(.b, .d).c');
  });

  it('wraps a root compound partial match in :is()', () => {
    const target = compound([el('.b'), el('.c')]);
    const result = tryExtendSelector(target, el('.b'), el('.d'), true);

    expect(result.error).toBeUndefined();
    expect(result.value).toBe(target);
    expect(serialize(result.value)).toBe(':is(.b, .d).c');
  });

  it('wraps a left-side complex partial match in :is()', () => {
    const target = sel([el('.parent'), co('>'), el('.child')]);
    const result = tryExtendSelector(target, el('.parent'), el('.container'), true);

    expect(result.error).toBeUndefined();
    expect(result.value).toBe(target);
    expect(serialize(result.value)).toBe(':is(.parent, .container) > .child');
  });

  it('wraps a partial match inside a sole :is() selector', () => {
    const target = is(compound([el('.b'), el('.c')]));
    const result = tryExtendSelector(target, el('.b'), el('.d'), true);

    expect(result.error).toBeUndefined();
    expect(result.value).toBe(target);
    expect(serialize(result.value)).toBe(':is(:is(.b, .d).c)');
  });

  it('appends a full match found inside a selector pseudo arg while in partial mode', () => {
    const target = pseudo({ name: ':where', arg: el('.b') });
    const result = tryExtendSelector(target, el('.b'), el('.d'), true);

    expect(result.error).toBeUndefined();
    expect(result.value).toBe(target);
    expect(serialize(result.value)).toBe(':where(.b, .d)');
  });

  it('appends into a selector-list arg inside a selector pseudo while in partial mode', () => {
    const target = pseudo({ name: ':where', arg: sellist([el('.x'), el('.b')]) });
    const result = tryExtendSelector(target, el('.b'), el('.d'), true);

    expect(result.error).toBeUndefined();
    expect(result.value).toBe(target);
    expect(serialize(result.value)).toBe(':where(.x, .b, .d)');
  });

  it('appends into a sole :is() selector-list arg while in partial mode', () => {
    const target = is(sellist([el('.x'), el('.b')]));
    const result = tryExtendSelector(target, el('.b'), el('.d'), true);

    expect(result.error).toBeUndefined();
    expect(result.value).toBe(target);
    expect(serialize(result.value)).toBe(':is(.x, .b, .d)');
  });

  it('wraps a partial match in a compound with a pseudo-class sibling', () => {
    const target = compound([el('.btn'), pseudo({ name: ':hover' })]);
    const result = tryExtendSelector(target, el('.btn'), el('.primary'), true);

    expect(result.error).toBeUndefined();
    expect(result.value).toBe(target);
    expect(serialize(result.value)).toBe(':is(.btn, .primary):hover');
  });

  it('wraps a partial match inside a root selector-list item', () => {
    const target = sellist([el('.x'), compound([el('.b'), el('.c')])]);
    const result = tryExtendSelector(target, el('.b'), el('.d'), true);

    expect(result.error).toBeUndefined();
    expect(result.value).toBe(target);
    expect(serialize(result.value)).toBe('.x, :is(.b, .d).c');
  });

  it('appends a full match found in a selector-list item while in partial mode', () => {
    const target = sellist([el('.x'), el('.b')]);
    const result = tryExtendSelector(target, el('.b'), el('.d'), true);

    expect(result.error).toBeUndefined();
    expect(result.value).toBe(target);
    expect(serialize(result.value)).toBe('.x, .b, .d');
  });

  it('extends within the own part of a leading ampersand when given a parent', () => {
    const parent = el('.parent');
    const target = sel([amp(), co(' '), el('.child')]);
    const result = tryExtendSelector(target, el('.child'), el('.other'), true, parent);

    expect(result.error).toBeUndefined();
    expect(result.value).toBe(target);
    expect(result.value.hoistToRoot).toBeFalsy();
    expect(serialize(result.value)).toBe('& :is(.child, .other)');
  });

  it('does not extend when only the parent side would match across a leading ampersand', () => {
    const parent = el('.parent');
    const target = sel([amp(), co(' '), el('.child')]);
    const result = tryExtendSelector(target, el('.parent'), el('.other'), true, parent);

    expect(result.value).toBe(target);
    expect(result.error?.type).toBe(ExtendErrorType.NOT_FOUND);
  });

  it('replaces a crossed leading ampersand with the parent and hoists on partial rewrite', () => {
    const parent = el('.parent');
    const target = sel([amp(), co(' '), el('.child')]);
    const find = sel([el('.parent'), co(' '), el('.child')]);
    const result = tryExtendSelector(target, find, el('.other'), true, parent);

    expect(result.error).toBeUndefined();
    expect(result.value.hoistToRoot).toBe(true);
    expect(serialize(result.value)).toBe('.parent .child, .other');
  });

  it('wraps a selector-list parent when replacing a crossed leading ampersand', () => {
    const parent = sellist([el('div'), el('span')]);
    const target = sel([amp(), co(' '), el('.child')]);
    const find = sel([el('span'), co(' '), el('.child')]);
    const result = tryExtendSelector(target, find, el('.other'), true, parent);

    expect(result.error).toBeUndefined();
    expect(result.value.hoistToRoot).toBe(true);
    expect(serialize(result.value)).toBe(':is(div, span) .child, .other');
  });

  it('splices in a complex parent directly when replacing a crossed leading ampersand', () => {
    const parent = sel([el('.grand'), co('>'), el('.parent')]);
    const target = sel([amp(), co(' '), el('.child')]);
    const find = sel([el('.grand'), co('>'), el('.parent'), co(' '), el('.child')]);
    const result = tryExtendSelector(target, find, el('.other'), true, parent);

    expect(result.error).toBeUndefined();
    expect(result.value.hoistToRoot).toBe(true);
    expect(serialize(result.value)).toBe('.grand > .parent .child, .other');
  });

  it('splices in a simple parent directly when replacing a crossed non-leading ampersand', () => {
    const parent = el('.parent');
    const target = sel([el('.prefix'), co(' '), amp()]);
    const find = sel([el('.prefix'), co(' '), el('.parent')]);
    const result = tryExtendSelector(target, find, el('.other'), true, parent);

    expect(result.error).toBeUndefined();
    expect(result.value.hoistToRoot).toBe(true);
    expect(serialize(result.value)).toBe('.prefix .parent, .other');
  });

  it('wraps a complex parent when replacing a crossed non-leading ampersand', () => {
    const parent = sel([el('.grand'), co('>'), el('.parent')]);
    const target = sel([el('.prefix'), co(' '), amp({ selectorContainer: { selector: parent } })]);
    const find = sel([el('.prefix'), co(' '), el('.grand'), co('>'), el('.parent')]);
    const result = tryExtendSelector(target, find, el('.other'), true, parent);

    expect(result.error).toBeUndefined();
    expect(result.value.hoistToRoot).toBe(true);
    expect(serialize(result.value)).toBe('.prefix :is(.grand > .parent), .other');
  });

  it('does not extend when combinators differ (space vs +)', () => {
    const target = sel([el('.ext8'), co(' '), el('.ext9')]);
    const find = sel([el('.ext8'), co('+'), el('.ext9')]);
    const result = tryExtendSelector(target, find, el('.zap'), true);

    expect(result.value).toBe(target);
    expect(result.error?.type).toBe(ExtendErrorType.NOT_FOUND);
  });

  it('does not extend a selector-list item when combinators differ', () => {
    const target = sellist([
      sel([el('.ext8'), co(' '), el('.ext9')]),
      el('.buu')
    ]);
    const find = sel([el('.ext8'), co('>'), el('.ext9')]);
    const result = tryExtendSelector(target, find, el('.zoo'), true);

    expect(result.value).toBe(target);
    expect(result.error?.type).toBe(ExtendErrorType.NOT_FOUND);
  });

  it('does not extend when the match exists only inside a resolved ampersand', () => {
    const target = compound([
      amp({ selectorContainer: { selector: el('.clearfix') } }),
      pseudo({ name: ':after' })
    ]);
    const result = tryExtendSelector(target, el('.clearfix'), el('.foo'), true);

    expect(result.value).toBe(target);
    expect(result.error?.type).toBe(ExtendErrorType.NOT_FOUND);
  });

  it('returns ELEMENT_CONFLICT when a partial compound rewrite would introduce a different element', () => {
    const target = compound([el('a'), el('.info')]);
    const result = tryExtendSelector(target, el('.info'), compound([el('div'), el('.foo')]), true);

    expect(result.value).toBe(target);
    expect(result.error?.type).toBe(ExtendErrorType.ELEMENT_CONFLICT);
    expect(serialize(result.value)).toBe('a.info');
  });

  it('returns ID_CONFLICT when a partial compound rewrite would introduce a different id', () => {
    const target = compound([el('#first'), el('.class')]);
    const result = tryExtendSelector(target, el('.class'), compound([el('#second'), el('.other')]), true);

    expect(result.value).toBe(target);
    expect(result.error?.type).toBe(ExtendErrorType.ID_CONFLICT);
    expect(serialize(result.value)).toBe('#first.class');
  });

  it('allows a partial compound rewrite when the extension uses the same element', () => {
    const target = compound([el('div'), el('.a')]);
    const result = tryExtendSelector(target, el('.a'), compound([el('div'), el('.b')]), true);

    expect(result.error).toBeUndefined();
    expect(result.value).toBe(target);
    expect(serialize(result.value)).toBe('div:is(.a, .b)');
  });

  it('allows a partial compound rewrite when the extension uses the same id', () => {
    const target = compound([el('#foo'), el('.class')]);
    const result = tryExtendSelector(target, el('.class'), compound([el('#foo'), el('.other')]), true);

    expect(result.error).toBeUndefined();
    expect(result.value).toBe(target);
    expect(serialize(result.value)).toBe('#foo:is(.class, .other)');
  });

  it('allows a different element when it stays in a different complex-selector position', () => {
    const target = sel([el('a'), co('>'), el('.class')]);
    const result = tryExtendSelector(target, el('.class'), compound([el('span'), el('.other')]), true);

    expect(result.error).toBeUndefined();
    expect(result.value).toBe(target);
    expect(serialize(result.value)).toBe('a > :is(.class, span.other)');
  });
});
