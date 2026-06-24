import { describe, it, expect } from 'vitest';
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
  F_IMPLICIT_AMPERSAND,
  F_VISIBLE,
  ExtendFlag
} from '../../index.js';
import { tryExtendSelector } from '../extend.js';

describe('Extend ampersand boundary behavior', () => {
  it('hoists a nested ruleset when extending crosses an implicit ampersand boundary', async () => {
    // Parser-built structure: .header { .header-nav { } } and .footer-nav { &:extend(.header .header-nav all) }
    // Inner selector is & .header-nav (implicit ampersand resolving to .header)
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
    const headerBody = rules([headerNav]);
    const header = ruleset({ selector: el('.header'), rules: headerBody });

    const root = rules([
      header,
      ruleset({
        selector: sel([el('.footer'), co(' '), el('.footer-nav')]),
        rules: [
          extend({
            target: sel([el('.header'), co(' '), el('.header-nav')]),
            flag: ExtendFlag.All
          })
        ]
      })
    ]);

    const context = new Context();
    const evald = await root.eval(context);
    const headerRuleset = evald.rules[0];
    const innerRuleset = headerRuleset?.rules?.rules?.[0];
    expect(innerRuleset?.hoistToRoot).toBe(true);
  });

  it('does not extend selectors that only match within an ampersand (e.g. &:before)', () => {
    // Unit test of tryExtendSelector: &:before should not match .header .header-nav extend
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
