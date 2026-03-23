import { describe, expect, it } from 'vitest';
import {
  any,
  call,
  decl,
  el,
  list,
  mixin,
  quoted,
  ref,
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

    const delta = context.session?.getRegistryDelta(root);
    const sessionEntries = delta?.declarationIndex?.get('bar');

    expect(sessionEntries?.has(injected)).toBe(true);
    expect(canonicalData?.declarationIndex?.has('bar')).toBe(false);
  });

  it('keeps session registry deltas when a clone swaps to a new child array', () => {
    const root = rules([
      vardecl({ name: 'foo', value: any('bar') })
    ]);
    const clone = root.clone(false) as Rules;
    const context = new Context();
    context.createSession();
    const injected = vardecl({ name: 'bar', value: any('baz') });

    clone.getRegistry('declaration');
    clone.register('declaration', injected, context);
    clone.setData([...clone.value, vardecl({ name: 'baz', value: any('qux') })]);

    expect(clone.find('declaration', 'bar', 'VarDeclaration', {
      context,
      searchParents: false
    })).toBe(injected);
    expect(context.session?.getRegistryDelta(clone)?.declarationIndex?.get('bar')?.has(injected)).toBe(true);
  });

  it('reuses the evaluated import root during finalization for plain imports', () => {
    const importedRules = rules([
      ruleset({
        selector: sellist([sel([el('.plain-import')])]),
        rules: rules([
          decl({ name: any('color'), value: any('red') })
        ])
      })
    ]);
    const evaluatedRules = importedRules.clone(false) as Rules;
    const node = style(
      { path: quoted(any('plain-import.jess')) },
      { type: 'import', importOptions: { once: false } }
    );

    const finalRules = node.getFinalRules(evaluatedRules);

    expect(finalRules).toBe(evaluatedRules);
    expect(finalRules.value).toBe(importedRules.value);
  });

  it('detaches the shared child array before cloning _dedupe rulesets in a session-backed finalization path', () => {
    const importedRules = rules([
      ruleset({
        selector: sellist([sel([el('.dedupe-import')])]),
        rules: rules([
          decl({ name: any('color'), value: any('red') })
        ])
      })
    ]);
    const evaluatedRules = importedRules.clone(false) as Rules;
    const originalRuleset = importedRules.at(0);
    const node = style(
      { path: quoted(any('dedupe-import.jess')) },
      { type: 'import', importOptions: { _dedupe: true } }
    );
    const context = new Context();
    context.createSession();

    const finalRules = node.getFinalRules(evaluatedRules, context);

    expect(finalRules).not.toBe(evaluatedRules);
    expect(finalRules.value).not.toBe(importedRules.value);
    expect(finalRules.at(0)).not.toBe(originalRuleset);
    expect(importedRules.at(0)).toBe(originalRuleset);
  });

  it('gives detached materialized wrappers their own registry slot while preserving canonical top-level parents', () => {
    const canonicalRuleset = ruleset({
      selector: sellist([sel([el('.materialized-wrapper')])]),
      rules: rules([
        decl({ name: any('color'), value: any('red') })
      ])
    });
    const canonicalRules = rules([canonicalRuleset]);
    canonicalRules.getRegistry('ruleset');
    const canonicalRegistry = peekRegistryData(canonicalRules.value);
    const context = new Context();
    context.createSession();

    const materializedWrapper = canonicalRules.cloneDetachedMaterializedWrapper(context) as Rules;
    materializedWrapper.getRegistry('ruleset');
    const wrapperRegistry = peekRegistryData(materializedWrapper.value);

    expect(materializedWrapper).not.toBe(canonicalRules);
    expect(materializedWrapper.value).not.toBe(canonicalRules.value);
    expect(materializedWrapper.at(0)).not.toBe(canonicalRuleset);
    expect(wrapperRegistry).toBeDefined();
    expect(wrapperRegistry).not.toBe(canonicalRegistry);
    expect(canonicalRuleset.parent).toBe(canonicalRules);
    expect(materializedWrapper.at(0)?.parent).toBe(materializedWrapper);
  });

  it('reuses the same canonical registry slot across repeated _dedupe imports', async () => {
    const context = createTestContext();
    context.sourceTrees.set('library-dedupe.jess', rules([
      ruleset({
        selector: sellist([sel([el('.deduped')])]),
        rules: rules([
          decl({ name: any('color'), value: any('red') })
        ])
      })
    ]));

    const firstRoot = rules([
      style({ path: quoted(any('library-dedupe.jess')) }, { type: 'import' })
    ]);
    await firstRoot.eval(context);

    expect(context.evaldTrees.size).toBe(1);
    const cached1 = [...context.evaldTrees.values()][0] as Rules;
    cached1.getRegistry('ruleset');
    const registryData1 = peekRegistryData(cached1.value);

    const secondRoot = rules([
      style({ path: quoted(any('library-dedupe.jess')) }, { type: 'import' })
    ]);
    await secondRoot.eval(context);

    expect(context.evaldTrees.size).toBe(1);
    const cached2 = [...context.evaldTrees.values()][0] as Rules;
    cached2.getRegistry('ruleset');
    const registryData2 = peekRegistryData(cached2.value);

    expect(registryData2).toBe(registryData1);
  });

  it('plain cached compose wrappers still share the cached registry slot when they share top-level child identity', async () => {
    const context = createTestContext();
    const libraryPath = 'library-compose-wrapper-registry.jess';
    context.sourceTrees.set(libraryPath, rules([
      ruleset({
        selector: sellist([sel([el('.imported')])]),
        rules: rules([
          decl({ name: any('color'), value: any('red') })
        ])
      })
    ]));

    const root = rules([
      style(
        { path: quoted(any(libraryPath)) },
        { type: 'compose', namespace: '*', importOptions: { mutable: true } }
      ),
      style(
        { path: quoted(any(libraryPath)) },
        { type: 'compose', namespace: '*', importOptions: { mutable: false, multiple: true } }
      )
    ]);

    const evald = await root.eval(context);
    const firstWrapper = evald.at(0) as Rules;
    const secondWrapper = evald.at(1) as Rules;
    const cachedEvaldRules = context.evaldTrees.get(libraryPath) as Rules;

    firstWrapper.getRegistry('ruleset');
    secondWrapper.getRegistry('ruleset');
    cachedEvaldRules.getRegistry('ruleset');

    const firstRegistry = peekRegistryData(firstWrapper.value);
    const secondRegistry = peekRegistryData(secondWrapper.value);
    const cachedRegistry = peekRegistryData(cachedEvaldRules.value);

    expect(firstWrapper).not.toBe(cachedEvaldRules);
    expect(secondWrapper).not.toBe(cachedEvaldRules);
    expect(firstWrapper.at(0)).toBe(cachedEvaldRules.at(0));
    expect(secondWrapper.at(0)).toBe(cachedEvaldRules.at(0));
    expect(firstWrapper.value).toBe(cachedEvaldRules.value);
    expect(secondWrapper.value).toBe(cachedEvaldRules.value);
    expect(firstRegistry).toBe(cachedRegistry);
    expect(secondRegistry).toBe(cachedRegistry);
  });

  it('keeps mixin expansion parameter vars in the active session delta', async () => {
    const context = new Context({
      leakyRules: true
    });
    context.depth = 2;
    context.createSession();

    const root = rules([
      mixin({
        name: any('.my-mixin'),
        params: list([
          any('shade', { role: 'property' })
        ]),
        rules: rules([
          decl({ name: 'color', value: ref({ key: 'shade' }, { type: 'variable' }) })
        ])
      }),
      call({
        name: ref({ key: '.my-mixin' }, { type: 'mixin' }),
        args: list([any('red')])
      })
    ]);
    context.root = root;

    const evald = await root.eval(context);
    const mixinOutput = evald.at(1) as Rules;
    const sessionDelta = context.session?.getRegistryDelta(mixinOutput);
    const canonicalData = peekRegistryData(mixinOutput.value);

    expect(mixinOutput.type).toBe('Rules');
    expect(sessionDelta?.declarationIndex?.get('shade')?.size).toBe(1);
    expect(canonicalData?.declarationIndex?.has('shade')).toBe(false);
  });
});
