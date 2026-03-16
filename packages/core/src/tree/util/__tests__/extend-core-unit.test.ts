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

  it('materializes an implicit parent boundary before exact extend output', () => {
    const parent = el('.parent');
    const target = el('.child');
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

  it('appends a full crossed match into a selector-list arg inside a selector pseudo while in partial mode', () => {
    const parent = el('.a');
    const target = pseudo({
      name: ':where',
      arg: sellist([
        compound([amp({ selectorContainer: { selector: parent } }), el('.x')]),
        el('.z')
      ])
    });
    const find = compound([el('.a'), el('.x')]);
    const result = tryExtendSelector(target, find, el('.other'), true, parent);

    expect(result.error).toBeUndefined();
    expect(result.value.hoistToRoot).toBe(true);
    expect(serialize(result.value)).toBe(':where(.a.x, .z, .other)');
  });

  it('appends into a sole :is() selector-list arg while in partial mode', () => {
    const target = is(sellist([el('.x'), el('.b')]));
    const result = tryExtendSelector(target, el('.b'), el('.d'), true);

    expect(result.error).toBeUndefined();
    expect(result.value).toBe(target);
    expect(serialize(result.value)).toBe(':is(.x, .b, .d)');
  });

  it('appends a full crossed match into a sole :is() selector-list arg while in partial mode', () => {
    const parent = el('.a');
    const target = is(sellist([
      compound([amp({ selectorContainer: { selector: parent } }), el('.x')]),
      el('.z')
    ]));
    const find = compound([el('.a'), el('.x')]);
    const result = tryExtendSelector(target, find, el('.other'), true, parent);

    expect(result.error).toBeUndefined();
    expect(result.value.hoistToRoot).toBe(true);
    expect(serialize(result.value)).toBe(':is(.a.x, .z, .other)');
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

  it('hoists and materializes the rest of a selector list when one item crosses an ampersand', () => {
    const parent = el('.parent');
    const target = sellist([
      sel([amp({ selectorContainer: { selector: parent } }), co(' '), el('.child')]),
      sel([amp({ selectorContainer: { selector: parent } }), co(' '), el('.sibling')])
    ]);
    const find = sel([el('.parent'), co(' '), el('.child')]);
    const result = tryExtendSelector(target, find, el('.other'), true, parent);

    expect(result.error).toBeUndefined();
    expect(result.value.hoistToRoot).toBe(true);
    expect(serialize(result.value)).toBe('.parent .child, .parent .sibling, .other');
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

  it('materializes an implicit parent boundary and hoists on partial rewrite', () => {
    const parent = el('.parent');
    const target = el('.child');
    const find = sel([el('.parent'), co(' '), el('.child')]);
    const result = tryExtendSelector(target, find, el('.other'), true, parent);

    expect(result.error).toBeUndefined();
    expect(result.value.hoistToRoot).toBe(true);
    expect(serialize(result.value)).toBe('.parent .child, .other');
  });

  it('materializes a crossed explicit ampersand on hoist even without a parent argument', () => {
    const resolvedParent = el('.parent');
    const target = sel([amp({ selectorContainer: { selector: resolvedParent } }), co(' '), el('.child')]);
    const find = sel([el('.parent'), co(' '), el('.child')]);
    const result = tryExtendSelector(target, find, el('.other'), true);

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

  it('resolves only the crossed ampersand inside a partial matched span', () => {
    const parent = el('.parent');
    const target = sel([amp({ selectorContainer: { selector: parent } }), co(' '), el('.child'), co(' '), amp({ selectorContainer: { selector: parent } })]);
    const find = sel([el('.parent'), co(' '), el('.child')]);
    const result = tryExtendSelector(target, find, el('.other'), true, parent);

    expect(result.error).toBeUndefined();
    expect(result.value.hoistToRoot).toBe(true);
    expect(serialize(result.value)).toBe(':is(.parent .child, .other) .parent');
  });

  it('groups only the matched crossed seam when multiple authored ampersands exist', () => {
    const parent = el('.a');
    const target = sel([
      compound([amp({ selectorContainer: { selector: parent } }), el('.x')]),
      co(' '),
      compound([amp({ selectorContainer: { selector: parent } }), el('.x')])
    ]);
    const find = compound([el('.a'), el('.x')]);
    const result = tryExtendSelector(target, find, el('.other'), true, parent);

    expect(result.error).toBeUndefined();
    expect(result.value.hoistToRoot).toBe(true);
    expect(serialize(result.value)).toBe(':is(.a.x, .other) .a.x');
  });

  it('creates a plain alternative when an exact match crosses multiple authored seams', () => {
    const parent = el('.a');
    const target = sel([
      compound([amp({ selectorContainer: { selector: parent } }), el('.x')]),
      co('+'),
      compound([amp({ selectorContainer: { selector: parent } }), el('.y')])
    ]);
    const find = sel([
      compound([el('.a'), el('.x')]),
      co('+'),
      compound([el('.a'), el('.y')])
    ]);
    const result = tryExtendSelector(target, find, el('.other'), true, parent);

    expect(result.error).toBeUndefined();
    expect(result.value.hoistToRoot).toBe(true);
    expect(serialize(result.value)).toBe('.a.x + .a.y, .other');
  });

  it('groups a crossed seam as one component inside a larger root compound', () => {
    const parent = el('.a');
    const target = compound([
      amp({ selectorContainer: { selector: parent } }),
      el('.x'),
      el('.y')
    ]);
    const find = compound([el('.a'), el('.x')]);
    const result = tryExtendSelector(target, find, el('.other'), true, parent);

    expect(result.error).toBeUndefined();
    expect(result.value.hoistToRoot).toBe(true);
    expect(serialize(result.value)).toBe(':is(.a.x, .other).y');
  });

  it('does not over-wrap unmatched tail compound members in a crossed ordered span', () => {
    const parent = el('.a');
    const target = sel([
      compound([amp({ selectorContainer: { selector: parent } }), el('.x')]),
      co('>'),
      compound([el('.y'), el('.w')])
    ]);
    const find = sel([
      compound([el('.a'), el('.x')]),
      co('>'),
      el('.y')
    ]);
    const result = tryExtendSelector(target, find, el('.other'), true, parent);

    expect(result.error).toBeUndefined();
    expect(result.value.hoistToRoot).toBe(true);
    expect(serialize(result.value)).toBe(':is(.a.x > .y, .other).w');
  });

  it('does not over-wrap an unmatched tail when a partial ordered span crosses multiple authored seams', () => {
    const parent = el('.a');
    const target = sel([
      compound([amp({ selectorContainer: { selector: parent } }), el('.x')]),
      co('+'),
      compound([amp({ selectorContainer: { selector: parent } }), el('.y'), el('.z')])
    ]);
    const find = sel([
      compound([el('.a'), el('.x')]),
      co('+'),
      compound([el('.a'), el('.y')])
    ]);
    const result = tryExtendSelector(target, find, el('.other'), true, parent);

    expect(result.error).toBeUndefined();
    expect(result.value.hoistToRoot).toBe(true);
    expect(serialize(result.value)).toBe(':is(.a.x + .a.y, .other).z');
  });

  it('rewrites a crossed ordered span inside one selector-list item without over-wrapping sibling items', () => {
    const parent = el('.a');
    const target = sellist([
      sel([
        compound([amp({ selectorContainer: { selector: parent } }), el('.x')]),
        co('>'),
        compound([el('.y'), el('.w')])
      ]),
      el('.z')
    ]);
    const find = sel([
      compound([el('.a'), el('.x')]),
      co('>'),
      el('.y')
    ]);
    const result = tryExtendSelector(target, find, el('.other'), true, parent);

    expect(result.error).toBeUndefined();
    expect(result.value.hoistToRoot).toBe(true);
    expect(serialize(result.value)).toBe(':is(.a.x > .y, .other).w, .z');
  });

  it('rewrites a crossed ordered span inside a selector pseudo arg without over-wrapping the tail', () => {
    const parent = el('.a');
    const target = pseudo({
      name: ':where',
      arg: sel([
        compound([amp({ selectorContainer: { selector: parent } }), el('.x')]),
        co('>'),
        compound([el('.y'), el('.w')])
      ])
    });
    const find = sel([
      compound([el('.a'), el('.x')]),
      co('>'),
      el('.y')
    ]);
    const result = tryExtendSelector(target, find, el('.other'), true, parent);

    expect(result.error).toBeUndefined();
    expect(result.value.hoistToRoot).toBe(true);
    expect(serialize(result.value)).toBe(':where(:is(.a.x > .y, .other).w)');
  });

  it('rewrites a crossed ordered span inside one nested :is() alternative without over-wrapping siblings', () => {
    const parent = el('.a');
    const target = is(sellist([
      sel([
        compound([amp({ selectorContainer: { selector: parent } }), el('.x')]),
        co('>'),
        compound([el('.y'), el('.w')])
      ]),
      el('.z')
    ]));
    const find = sel([
      compound([el('.a'), el('.x')]),
      co('>'),
      el('.y')
    ]);
    const result = tryExtendSelector(target, find, el('.other'), true, parent);

    expect(result.error).toBeUndefined();
    expect(result.value.hoistToRoot).toBe(true);
    expect(serialize(result.value)).toBe(':is(:is(.a.x > .y, .other).w, .z)');
  });

  it('rewrites a crossed compound seam inside one nested :is() alternative without over-wrapping siblings', () => {
    const parent = el('.a');
    const target = is(sellist([
      compound([amp({ selectorContainer: { selector: parent } }), el('.x'), el('.y')]),
      el('.z')
    ]));
    const find = compound([el('.a'), el('.x')]);
    const result = tryExtendSelector(target, find, el('.other'), true, parent);

    expect(result.error).toBeUndefined();
    expect(result.value.hoistToRoot).toBe(true);
    expect(serialize(result.value)).toBe(':is(:is(.a.x, .other).y, .z)');
  });

  it('rewrites a crossed compound seam inside a non-:is() selector pseudo arg without over-wrapping sibling alternatives', () => {
    const parent = el('.a');
    const target = pseudo({
      name: ':where',
      arg: sellist([
        compound([amp({ selectorContainer: { selector: parent } }), el('.x'), el('.y')]),
        el('.z')
      ])
    });
    const find = compound([el('.a'), el('.x')]);
    const result = tryExtendSelector(target, find, el('.other'), true, parent);

    expect(result.error).toBeUndefined();
    expect(result.value.hoistToRoot).toBe(true);
    expect(serialize(result.value)).toBe(':where(:is(.a.x, .other).y, .z)');
  });

  it('rewrites a crossed ordered span inside a non-:is() selector pseudo arg without over-wrapping sibling alternatives', () => {
    const parent = el('.a');
    const target = pseudo({
      name: ':where',
      arg: sellist([
        sel([
          compound([amp({ selectorContainer: { selector: parent } }), el('.x')]),
          co('>'),
          compound([el('.y'), el('.w')])
        ]),
        el('.z')
      ])
    });
    const find = sel([
      compound([el('.a'), el('.x')]),
      co('>'),
      el('.y')
    ]);
    const result = tryExtendSelector(target, find, el('.other'), true, parent);

    expect(result.error).toBeUndefined();
    expect(result.value.hoistToRoot).toBe(true);
    expect(serialize(result.value)).toBe(':where(:is(.a.x > .y, .other).w, .z)');
  });

  it('materializes remaining ampersands with the normal wrapping rules after hoisting', () => {
    const parent = sel([el('.grand'), co('>'), el('.parent')]);
    const target = sel([amp({ selectorContainer: { selector: parent } }), co(' '), el('.prefix'), co(' '), amp({ selectorContainer: { selector: parent } }), co(' '), el('.child')]);
    const find = sel([el('.grand'), co('>'), el('.parent'), co(' '), el('.child')]);
    const result = tryExtendSelector(target, find, el('.other'), true, parent);

    expect(result.error).toBeUndefined();
    expect(result.value.hoistToRoot).toBe(true);
    expect(serialize(result.value)).toBe('.grand > .parent .prefix :is(.grand > .parent .child, .other)');
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

  it('wraps the full matched segment when a partial match spans a combinator', () => {
    const target = sel([
      el('div'),
      co('+'),
      compound([el('.a'), el('.c'), el('.b')]),
      co('>'),
      compound([el('.y'), el('.x')])
    ]);
    const find = sel([
      compound([el('.a'), el('.b')]),
      co('>'),
      el('.x')
    ]);
    const result = tryExtendSelector(target, find, el('.q'), true);

    expect(result.error).toBeUndefined();
    expect(result.value).toBe(target);
    expect(serialize(result.value)).toBe('div + :is(.a.c.b > .y.x, .q)');
  });

  it('wraps only the matched compound subspan inside a larger root compound', () => {
    const target = compound([el('.a'), el('.b'), el('.c')]);
    const find = compound([el('.a'), el('.b')]);
    const result = tryExtendSelector(target, find, el('.q'), true);

    expect(result.error).toBeUndefined();
    expect(result.value).toBe(target);
    expect(serialize(result.value)).toBe(':is(.a.b, .q).c');
  });

  it('groups non-sequential matched compound members in :is() and leaves the gap outside', () => {
    const target = compound([el('.b'), el('.a'), el('.x')]);
    const find = compound([el('.b'), el('.x')]);
    const result = tryExtendSelector(target, find, el('.q'), true);

    expect(result.error).toBeUndefined();
    expect(result.value).toBe(target);
    expect(serialize(result.value)).toBe(':is(.b.x, .q).a');
  });

  it('wraps a partial match inside one root :is() alternative only', () => {
    const target = is(sellist([
      sel([el('.foo'), co(' '), el('.bar')]),
      el('.baz')
    ]));
    const result = tryExtendSelector(target, el('.bar'), el('.q'), true);

    expect(result.error).toBeUndefined();
    expect(result.value).toBe(target);
    expect(serialize(result.value)).toBe(':is(.foo :is(.bar, .q), .baz)');
  });

  it('wraps a partial match inside one nested :is() alternative within a compound', () => {
    const target = compound([
      el('.outer'),
      is(sellist([compound([el('.a'), el('.b')]), el('.x')])),
      el('.tail')
    ]);
    const result = tryExtendSelector(target, el('.a'), el('.q'), true);

    expect(result.error).toBeUndefined();
    expect(result.value).toBe(target);
    expect(serialize(result.value)).toBe('.outer:is(:is(.a, .q).b, .x).tail');
  });

  it('appends into a nested :is() list within a compound when the inner match is full', () => {
    const target = compound([
      el('.a'),
      is(sellist([el('.b'), el('.c')])),
      el('.d')
    ]);
    const result = tryExtendSelector(target, el('.b'), el('.q'), true);

    expect(result.error).toBeUndefined();
    expect(result.value).toBe(target);
    expect(serialize(result.value)).toBe('.a:is(.b, .c, .q).d');
  });

  it('pulls an outer compound match into a nested :is() branch when they refer to the same component', () => {
    const target = sel([
      el('qux'),
      co('>'),
      compound([
        el('.a'),
        is(sel([el('div'), co('>'), el('.b')])),
        el('.c')
      ]),
      co('>'),
      el('qux')
    ]);
    const result = tryExtendSelector(target, compound([el('.a'), el('.b')]), el('.foo'), true);

    expect(result.error).toBeUndefined();
    expect(result.value).toBe(target);
    expect(serialize(result.value)).toBe('qux > :is(div > :is(.a.b, .foo)).c > qux');
  });

  it('can pull a target from a nested :is() branch into the surrounding compound component', () => {
    const target = compound([
      el('.a'),
      is(sel([el('div'), co('>'), el('.c')])),
      el('.b')
    ]);
    const result = tryExtendSelector(target, sel([el('div'), co('>'), el('.c')]), el('.foo'), true);

    expect(result.error).toBeUndefined();
    expect(result.value).toBe(target);
    expect(serialize(result.value)).toBe('.a:is(div > .c, .foo).b');
  });

  it('creates a plain alternative when a full match crosses out of a nested :is() branch', () => {
    const target = compound([
      is(sellist([el('.a'), el('.b')])),
      el('.c')
    ]);
    const result = tryExtendSelector(target, compound([el('.b'), el('.c')]), el('.d'), true);

    expect(result.error).toBeUndefined();
    expect(serialize(result.value)).toBe(':is(.a, .b).c, .d');
  });

  it('preserves nested :is() structure when the partial match stays within the same inner group', () => {
    const target = compound([
      is(sellist([el('.g'), compound([el('.i'), el('.j')])])),
      el('.h')
    ]);
    const result = tryExtendSelector(target, el('.i'), el('.k'), true);

    expect(result.error).toBeUndefined();
    expect(serialize(result.value)).toBe(':is(.g, :is(.i, .k).j).h');
  });

  it('appends into a nested :is() list when a full compound match stays within that inner group', () => {
    const target = compound([
      is(sellist([el('.g'), compound([el('.i'), el('.j')])])),
      el('.h')
    ]);
    const result = tryExtendSelector(target, compound([el('.i'), el('.j')]), el('.k'), true);

    expect(result.error).toBeUndefined();
    expect(serialize(result.value)).toBe(':is(.g, .i.j, .k).h');
  });

  it('appends a full crossed match into a nested :is() list within a compound', () => {
    const parent = el('.a');
    const target = compound([
      is(sellist([
        compound([amp({ selectorContainer: { selector: parent } }), el('.x')]),
        el('.z')
      ])),
      el('.h')
    ]);
    const find = compound([el('.a'), el('.x')]);
    const result = tryExtendSelector(target, find, el('.k'), true, parent);

    expect(result.error).toBeUndefined();
    expect(result.value.hoistToRoot).toBe(true);
    expect(serialize(result.value)).toBe(':is(.a.x, .z, .k).h');
  });

  it('appends a full crossed ordered span into a nested :is() list within a compound', () => {
    const parent = el('.a');
    const target = compound([
      is(sellist([
        sel([
          compound([amp({ selectorContainer: { selector: parent } }), el('.x')]),
          co('>'),
          el('.y')
        ]),
        el('.z')
      ])),
      el('.h')
    ]);
    const find = sel([
      compound([el('.a'), el('.x')]),
      co('>'),
      el('.y')
    ]);
    const result = tryExtendSelector(target, find, el('.k'), true, parent);

    expect(result.error).toBeUndefined();
    expect(result.value.hoistToRoot).toBe(true);
    expect(serialize(result.value)).toBe(':is(.a.x > .y, .z, .k).h');
  });

  it('appends a full crossed ordered span into a non-:is() selector pseudo arg within a compound', () => {
    const parent = el('.a');
    const target = compound([
      pseudo({
        name: ':where',
        arg: sellist([
          sel([
            compound([amp({ selectorContainer: { selector: parent } }), el('.x')]),
            co('>'),
            el('.y')
          ]),
          el('.z')
        ])
      }),
      el('.h')
    ]);
    const find = sel([
      compound([el('.a'), el('.x')]),
      co('>'),
      el('.y')
    ]);
    const result = tryExtendSelector(target, find, el('.k'), true, parent);

    expect(result.error).toBeUndefined();
    expect(result.value.hoistToRoot).toBe(true);
    expect(serialize(result.value)).toBe(':where(.a.x > .y, .z, .k).h');
  });

  it('appends a full crossed compound match into a non-:is() selector pseudo arg within a compound', () => {
    const parent = el('.a');
    const target = compound([
      pseudo({
        name: ':where',
        arg: sellist([
          compound([amp({ selectorContainer: { selector: parent } }), el('.x')]),
          el('.z')
        ])
      }),
      el('.h')
    ]);
    const find = compound([el('.a'), el('.x')]);
    const result = tryExtendSelector(target, find, el('.k'), true, parent);

    expect(result.error).toBeUndefined();
    expect(result.value.hoistToRoot).toBe(true);
    expect(serialize(result.value)).toBe(':where(.a.x, .z, .k).h');
  });

  it('appends a full crossed ordered span into a non-:is() selector pseudo arg within a complex selector', () => {
    const parent = el('.a');
    const target = sel([
      el('div'),
      co('>'),
      pseudo({
        name: ':where',
        arg: sellist([
          sel([
            compound([amp({ selectorContainer: { selector: parent } }), el('.x')]),
            co('>'),
            el('.y')
          ]),
          el('.z')
        ])
      })
    ]);
    const find = sel([
      compound([el('.a'), el('.x')]),
      co('>'),
      el('.y')
    ]);
    const result = tryExtendSelector(target, find, el('.k'), true, parent);

    expect(result.error).toBeUndefined();
    expect(result.value.hoistToRoot).toBe(true);
    expect(serialize(result.value)).toBe('div > :where(.a.x > .y, .z, .k)');
  });
});
