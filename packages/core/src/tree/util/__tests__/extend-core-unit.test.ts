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
    expect(serialize(result.value)).toBe(':is(.parent .child, .other)');
  });

  it('wraps a selector-list parent when replacing a crossed leading ampersand', () => {
    const parent = sellist([el('div'), el('span')]);
    const target = sel([amp(), co(' '), el('.child')]);
    const find = sel([el('span'), co(' '), el('.child')]);
    const result = tryExtendSelector(target, find, el('.other'), true, parent);

    expect(result.error).toBeUndefined();
    expect(result.value.hoistToRoot).toBe(true);
    expect(serialize(result.value)).toBe(':is(:is(div, span) .child, .other)');
  });

  it('splices in a complex parent directly when replacing a crossed leading ampersand', () => {
    const parent = sel([el('.grand'), co('>'), el('.parent')]);
    const target = sel([amp(), co(' '), el('.child')]);
    const find = sel([el('.grand'), co('>'), el('.parent'), co(' '), el('.child')]);
    const result = tryExtendSelector(target, find, el('.other'), true, parent);

    expect(result.error).toBeUndefined();
    expect(result.value.hoistToRoot).toBe(true);
    expect(serialize(result.value)).toBe(':is(.grand > .parent .child, .other)');
  });

  it('splices in a simple parent directly when replacing a crossed non-leading ampersand', () => {
    const parent = el('.parent');
    const target = sel([el('.prefix'), co(' '), amp()]);
    const find = sel([el('.prefix'), co(' '), el('.parent')]);
    const result = tryExtendSelector(target, find, el('.other'), true, parent);

    expect(result.error).toBeUndefined();
    expect(result.value.hoistToRoot).toBe(true);
    expect(serialize(result.value)).toBe(':is(.prefix .parent, .other)');
  });
});
