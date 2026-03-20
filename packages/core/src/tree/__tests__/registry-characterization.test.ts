import { describe, expect, it } from 'vitest';
import {
  any,
  decl,
  el,
  quoted,
  rules,
  ruleset,
  sel,
  sellist,
  style,
  vardecl,
  type Rules
} from '../index.js';
import { Context } from '../../context.js';
import { createTestContext } from './import-style-test-helpers.js';
import { peekRegistryData } from '../util/registry-utils.js';

describe('registry characterization', () => {
  it('reuses the same canonical registry slot across cached compose imports', async () => {
    const context = createTestContext();
    context.sourceTrees.set('library-registry.jess', rules([
      ruleset({
        selector: sellist([sel([el('.imported')])]),
        rules: rules([
          decl({ name: any('color'), value: any('red') })
        ])
      })
    ]));

    const firstRoot = rules([
      style({ path: quoted(any('library-registry.jess')) }, { type: 'compose', namespace: '*' })
    ]);
    await firstRoot.eval(context);

    expect(context.evaldTrees.size).toBe(1);
    const cached1 = [...context.evaldTrees.values()][0] as Rules;
    cached1.getRegistry('ruleset');
    const registryData1 = peekRegistryData(cached1.value);

    expect(registryData1).toBeDefined();

    const secondRoot = rules([
      style({ path: quoted(any('library-registry.jess')) }, { type: 'compose', namespace: '*' })
    ]);
    await secondRoot.eval(context);

    expect(context.evaldTrees.size).toBe(1);
    const cached2 = [...context.evaldTrees.values()][0] as Rules;
    cached2.getRegistry('ruleset');
    const registryData2 = peekRegistryData(cached2.value);

    expect(cached2).toBe(cached1);
    expect(registryData2).toBe(registryData1);
  });

  it('keeps session-only declaration registrations out of the canonical cache', () => {
    const root = rules([
      vardecl({ name: 'foo', value: any('bar') })
    ]);
    root.getRegistry('declaration');
    const canonicalData = peekRegistryData(root.value);

    expect(canonicalData?.declarationIndex?.has('bar')).toBe(false);

    const context = new Context();
    context.createSession();
    const injected = vardecl({ name: 'bar', value: any('baz') });

    root.register('declaration', injected, context);

    const delta = context.session?.getRegistryDelta(root.value);
    const sessionEntries = delta?.declarationIndex?.get('bar');

    expect(sessionEntries?.has(injected)).toBe(true);
    expect(canonicalData?.declarationIndex?.has('bar')).toBe(false);
  });
});
