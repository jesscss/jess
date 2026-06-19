import { describe, expect, test } from 'vitest';
import {
  IslandParsePlan,
  IslandParserRegistry,
  LanguageActivationRegistry,
  SourceText,
  createParserDiagnostic,
  parseStructure,
  providerKey,
  stableConfigKey
} from '../index.js';
import { fixtureLessProfile, fixtureProfile } from './fixtures.js';

describe('IslandParsePlan', () => {
  test('returns stable request ids and exposes request views lazily', () => {
    const document = parseStructure(
      new SourceText('.foo { color: @brand; }', { version: 3 }),
      fixtureLessProfile
    );
    const plan = new IslandParsePlan(document);
    const island = document.islands('variable-reference')[0]!;

    const first = plan.requestIsland(island, 'core-value', { mathMode: 'always' });
    const second = plan.requestIsland(island, 'core-value', { mathMode: 'always' });

    expect(second).toBe(first);
    expect(plan.counters.requestIds).toBe(1);
    expect(plan.counters.requestViews).toBe(0);
    expect(plan.requestView(first)).toMatchObject({
      id: first,
      language: 'fixture-less',
      islandKind: 'variable-reference',
      targetShape: 'core-value',
      sourceVersion: '3',
      start: island.start,
      end: island.end
    });
    expect(plan.counters.requestViews).toBe(1);
  });

  test('executes providers once and then serves cached records', () => {
    const document = parseStructure(
      new SourceText('.foo { color: @brand; }', { version: 1 }),
      fixtureLessProfile
    );
    const registry = new IslandParserRegistry();
    let calls = 0;
    registry.register(
      providerKey('fixture-less', 'variable-reference', 'core-value', {
        mathMode: 'always'
      }),
      context => {
        calls++;
        return {
          value: context.document.source.slice(context.island.start, context.island.end)
        };
      }
    );
    const plan = new IslandParsePlan(document, registry);
    const island = document.islands('variable-reference')[0]!;
    const id = plan.requestIsland(island, 'core-value', { mathMode: 'always' });

    expect(plan.execute<string>(id)).toMatchObject({
      requestId: id,
      value: '@brand',
      diagnostics: [],
      fallbackFullTree: false
    });
    expect(plan.execute<string>(id).value).toBe('@brand');
    expect(calls).toBe(1);
    expect(plan.counters).toMatchObject({
      cacheHits: 1,
      cacheMisses: 1,
      actualParses: 1,
      promotedBytes: 6
    });
  });

  test('caches execution diagnostics separately from thrown exceptional failures', () => {
    const document = parseStructure(
      new SourceText('.foo { color: @brand; }', { version: 1 }),
      fixtureLessProfile
    );
    const registry = new IslandParserRegistry();
    registry.register(providerKey('fixture-less', 'variable-reference', 'core-value'), () => ({
      diagnostics: [
        createParserDiagnostic({
          code: 'mock-diagnostic',
          message: 'Mock diagnostic.',
          start: 14,
          end: 20,
          context: 'test'
        })
      ]
    }));
    const plan = new IslandParsePlan(document, registry);
    const id = plan.requestIsland(document.islands('variable-reference')[0]!, 'core-value');

    const record = plan.execute(id);

    expect(record.diagnostics).toEqual([
      expect.objectContaining({ code: 'mock-diagnostic' })
    ]);
    expect(plan.diagnosticsFor(id)).toEqual(record.diagnostics);
  });

  test('records fallback full-tree materialization when no provider is registered', () => {
    const document = parseStructure(
      new SourceText('.foo { color: @brand; }', { version: 1 }),
      fixtureLessProfile
    );
    const plan = new IslandParsePlan(document);
    const id = plan.requestIsland(document.islands('variable-reference')[0]!, 'core-value');

    expect(plan.execute(id)).toMatchObject({
      requestId: id,
      diagnostics: [],
      fallbackFullTree: true
    });
    expect(plan.counters).toMatchObject({
      fallbackFullTreeMaterializations: 1,
      actualParses: 0
    });
  });

  test('requestNode returns island request ids without parsing siblings', () => {
    const document = parseStructure(
      new SourceText('.foo { color: @brand; width: 1px; }', { version: 1 }),
      fixtureLessProfile
    );
    const plan = new IslandParsePlan(document);
    const variableIsland = document.islands('variable-reference')[0]!;

    const ids = plan.requestNode(variableIsland.owner, 'core-value');

    expect(ids).toContain(plan.requestIsland(variableIsland, 'core-value'));
    expect(ids).toHaveLength(2);
    expect(plan.counters.actualParses).toBe(0);
  });

  test('visitor planning does not promote the whole tree', () => {
    const document = parseStructure(
      new SourceText('.foo { color: @brand; }', { version: 1 }),
      fixtureLessProfile
    );
    const plan = new IslandParsePlan(document);

    expect(
      plan.planVisitor({
        nodeKinds: ['declaration'],
        islandKinds: ['variable-reference'],
        targetShape: 'visitor-node'
      })
    ).toEqual([
      {
        nodeKind: 'declaration',
        islandKinds: ['variable-reference'],
        targetShape: 'visitor-node'
      }
    ]);
    expect(plan.counters).toMatchObject({
      visitorPlans: 1,
      actualParses: 0,
      fallbackFullTreeMaterializations: 0
    });
  });

  test('structural-only requestNode queries report zero materialization', () => {
    const document = parseStructure('.foo { color: red; }', fixtureProfile);
    const plan = new IslandParsePlan(document);
    const root = document.root;

    expect(plan.requestNode(root, 'core-selector')).toEqual([]);
    expect(plan.counters).toMatchObject({
      structuralOnlyQueries: 1,
      actualParses: 0
    });
  });

  test('stable config keys are order-insensitive', () => {
    expect(stableConfigKey({ b: true, a: ['x', 1] })).toBe(
      stableConfigKey({ a: ['x', 1], b: true })
    );
  });
});

describe('LanguageActivationRegistry', () => {
  test('lets plugins bind custom profiles and island providers to extensions', () => {
    const registry = new LanguageActivationRegistry();
    const tailwindProfile = {
      ...fixtureLessProfile,
      name: 'tailwind-utility-css'
    };

    registry.register({
      name: 'tailwind-plugin',
      profile: tailwindProfile,
      supportedExtensions: ['pcss'],
      configureIslandProviders(islandRegistry) {
        islandRegistry.register(providerKey('tailwind-utility-css', 'declaration-value', 'tailwind-value'), context => ({
          value: context.document.source.slice(context.island.start, context.island.end)
        }));
      }
    });

    const document = registry.parseStructureForExtension('.pcss', '.btn { color: theme(colors.red.500); }');
    expect(document?.profile.name).toBe('tailwind-utility-css');

    const plan = registry.createIslandParsePlanForExtension('pcss', document!);
    const rule = document!.root.children[0]!;
    if (!('children' in rule)) {
      throw new Error('Expected custom profile document to contain a rule.');
    }
    const [requestId] = plan!.requestNode(rule.children[0]!, 'tailwind-value');

    expect(plan!.execute(requestId!).value).toBe('theme(colors.red.500)');
  });
});
