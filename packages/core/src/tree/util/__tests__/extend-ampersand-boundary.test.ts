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
  F_VISIBLE,
  ExtendFlag
} from '../../index.js';
import { F_IMPLICIT_AMPERSAND } from '../../node.js';
import type { Ruleset } from '../../index.js';
import { tryExtendSelector } from '../extend.js';

describe('Extend ampersand boundary behavior', () => {
  it('hoists a nested ruleset when extending crosses an implicit ampersand boundary', async () => {
    // Parser-built structure: .header { .header-nav { } } and .footer-nav { &:extend(.header .header-nav all) }
    // Inner selector is & .header-nav (implicit ampersand resolving to .header)
    const implicitAmp = amp({ selectorContainer: { selector: el('.header') } });
    implicitAmp.generated = true;
    implicitAmp.addFlag(F_IMPLICIT_AMPERSAND);
    implicitAmp.removeFlag(F_VISIBLE);
    const implicitSpace = co(' ');
    implicitSpace.generated = true;
    implicitSpace.removeFlag(F_VISIBLE);

    const headerNav = ruleset({
      selector: sel([implicitAmp, implicitSpace, el('.header-nav')]),
      rules: []
    });
    const header = ruleset({ selector: el('.header'), rules: [headerNav] });

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
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const headerRuleset = evald.rules[0] as unknown as Ruleset;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const innerRuleset = headerRuleset?.rules?.[0] as Ruleset | undefined;
    expect(innerRuleset?.hoistToRoot).toBe(true);
  });

  it('does not extend selectors that only match within an ampersand (e.g. &:before)', () => {
    // Unit test of tryExtendSelector: &:before should not match .header .header-nav extend
    const resolvedParent = sel([el('.header'), co(' '), el('.header-nav')]);
    const ampersand = amp({ selectorContainer: { selector: resolvedParent } });
    const beforeSelector = compound([ampersand, pseudo({ name: ':before' })]);

    const target = sel([el('.header'), co(' '), el('.header-nav')]);
    const extendWith = sel([el('.footer'), co(' '), el('.footer-nav')]);

    const result = tryExtendSelector(beforeSelector, target, extendWith, true);

    expect(result.error).toBeDefined();
    expect(result.value.toString()).toBe('&:before');
  });
});
