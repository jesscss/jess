import { describe, it, expect, beforeEach } from 'vitest';
import { Context } from '../../../context.js';
import {
  rules,
  ruleset,
  extend,
  el,
  sel,
  co,
  amp,
  compound,
  pseudo,
  type Rules,
  F_IMPLICIT_AMPERSAND,
  F_VISIBLE
} from '../../index.js';
import { tryExtendSelector } from '../extend.js';
import { processExtends } from '../extend-roots.js';

describe('Extend ampersand boundary behavior', () => {
  let context: Context;
  let rootRules: Rules;

  beforeEach(() => {
    context = new Context();
    rootRules = rules([]);
    context.root = rootRules;
    context.extendRoots.root = rootRules;
    context.extendRoots.registerRoot(rootRules);
  });

  it('hoists a nested ruleset when extending crosses an implicit ampersand boundary', () => {
    // Build a nested structure equivalent to:
    // .header { .header-nav { ... } }
    //
    // But represent `.header-nav` as having an implicit ampersand that resolves to `.header`.

    const headerBody = rules([]);
    const header = ruleset({ selector: el('.header'), rules: headerBody });
    rootRules.value.push(header);
    rootRules.register('ruleset', header);

    // `.header-nav` selector with implicit `& ` prefix resolving to `.header`
    const implicitAmp = amp({ selector: el('.header') });
    implicitAmp.generated = true;
    implicitAmp.addFlag(F_IMPLICIT_AMPERSAND);
    implicitAmp.removeFlag(F_VISIBLE);
    const implicitSpace = co(' ');
    implicitSpace.generated = true;
    implicitSpace.removeFlag(F_VISIBLE);

    const headerNavBody = rules([]);
    const headerNav = ruleset({
      selector: sel([implicitAmp, implicitSpace, el('.header-nav')]),
      rules: headerNavBody
    });
    headerBody.value.push(headerNav);
    headerBody.register('ruleset', headerNav);

    // Register nested roots so extend lookup can see into them
    context.extendRoots.registerRoot(headerBody, rootRules);
    context.extendRoots.registerRoot(headerNavBody, headerBody);

    // Extend declared elsewhere:
    // .footer-nav { &:extend(.header .header-nav all) }
    const target = sel([el('.header'), co(' '), el('.header-nav')]);
    const extendWith = sel([el('.footer'), co(' '), el('.footer-nav')]);
    const extendNode = extend({ target });
    context.extends.push([target, extendWith, true, rootRules, extendNode]);

    processExtends(context);

    // If we don't hoist, this selector list would still render inside `.header { ... }`
    // and would incorrectly prefix `.footer .footer-nav` with `.header`.
    expect(headerNav.hoistToRoot).toBe(true);
  });

  it('does not extend selectors that only match within an ampersand (e.g. &:before)', () => {
    // Represents the nested selector `&:before` whose `&` resolves to `.header .header-nav`.
    // Extending `.header .header-nav` should NOT mutate `&:before`; the parent ruleset should carry the extend.

    const resolvedParent = sel([el('.header'), co(' '), el('.header-nav')]);
    const ampersand = amp({ selector: resolvedParent });
    const beforeSelector = compound([ampersand, pseudo({ name: ':before' })]);

    const target = sel([el('.header'), co(' '), el('.header-nav')]);
    const extendWith = sel([el('.footer'), co(' '), el('.footer-nav')]);

    const result = tryExtendSelector(beforeSelector, target, extendWith, true);

    expect(result.error).toBeDefined();
    expect(result.value.toString()).toBe('&:before');
  });
});

