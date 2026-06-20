import { describe, expect, test } from 'vitest';
import { IslandParsePlan, IslandParserRegistry } from '@jesscss/parser';
import { serializeTypes } from '@jesscss/core';
import {
  parseLessStructure,
  lessParserConfigKey,
  registerLessIslandProviders
} from '../src/index.js';

describe('Less island providers', () => {
  test('classifies Less variable references without promoting literal at-sign text', () => {
    const document = parseLessStructure(
      'fixture.less',
      '.foo { content: "@media"; background: url("@asset"); color: @brand; escaped: \\@literal; --raw: @literal; }'
    );

    expect(document.islands('variable-reference').map(island =>
      document.source.slice(island.start, island.end)
    )).toEqual(['@brand', '@literal']);
  });

  test('classifies numeric Less variable references', () => {
    const document = parseLessStructure(
      'fixture.less',
      '@1: red; .foo { color: @1; }'
    );

    expect(document.islands('variable-reference').map(island =>
      document.source.slice(island.start, island.end)
    )).toEqual(['@1']);
  });

  test('classifies variable references after URL slash text', () => {
    const document = parseLessStructure(
      'fixture.less',
      '.foo { background: url(http://example.com) @brand; }'
    );

    expect(document.islands('variable-reference').some(island =>
      document.source.slice(island.start, island.end).includes('@brand')
    )).toBe(true);
  });

  test('classifies Less variable references in at-rule preludes without promoting literal at-sign text', () => {
    const withVariable = parseLessStructure(
      'fixture.less',
      '@media @breakpoint { .foo { color: red; } }'
    );
    const withFeatureVariable = parseLessStructure(
      'fixture.less',
      '@media (min-width: @size) { .foo { color: red; } }'
    );
    const withLiteralAtSigns = parseLessStructure(
      'fixture.less',
      '@media "@screen" /* @comment */ { .foo { color: red; } }'
    );

    expect(withVariable.islands('variable-reference')).toHaveLength(1);
    expect(withVariable.source.slice(
      withVariable.islands('variable-reference')[0]!.start,
      withVariable.islands('variable-reference')[0]!.end
    )).toBe('@breakpoint');
    expect(withFeatureVariable.islands('variable-reference')).toHaveLength(1);
    expect(withLiteralAtSigns.islands('variable-reference')).toEqual([]);
  });

  test('promotes Less selector/extend islands with config-aware keys', () => {
    const document = parseLessStructure('fixture.less', '.foo:extend(.bar) { color: red; }');
    const registry = new IslandParserRegistry();
    const config = { mathMode: 'always' as const };
    registerLessIslandProviders(registry, config);
    const plan = new IslandParsePlan(document, registry);
    const island = document.islands('extend-candidate')[0]!;
    const id = plan.requestIsland(island, 'less-selector', lessParserConfigKey(config));

    const record = plan.execute(id);

    expect(serializeTypes(record.value)).toContainString('(Extend');
    expect(record.diagnostics).toEqual([]);
    expect(plan.counters.actualParses).toBe(1);
  });

  test('promotes Less values and reference-like islands independently', () => {
    const document = parseLessStructure('fixture.less', '.foo { color: @brand; width: 1px; }');
    const registry = new IslandParserRegistry();
    registerLessIslandProviders(registry);
    const plan = new IslandParsePlan(document, registry);
    const island = document.islands('variable-reference')[0]!;
    const id = plan.requestIsland(island, 'less-value', lessParserConfigKey({}));

    const record = plan.execute(id);

    expect(serializeTypes(record.value)).toContainString('(Reference');
    expect(plan.counters).toMatchObject({
      actualParses: 1,
      fallbackFullTreeMaterializations: 0
    });
  });

  test('classifies Less variable declaration values as declaration-value islands', () => {
    const document = parseLessStructure('fixture.less', '@brand: red; .foo { color: @brand; }');
    const registry = new IslandParserRegistry();
    registerLessIslandProviders(registry);
    const plan = new IslandParsePlan(document, registry);
    const variableValueIsland = document.islands('declaration-value').find(
      island => island.owner.kind === 'variable-declaration'
    );

    expect(variableValueIsland).toBeDefined();
    expect(document.source.slice(variableValueIsland!.start, variableValueIsland!.end)).toBe('red');

    const record = plan.execute(
      plan.requestIsland(variableValueIsland!, 'less-value', lessParserConfigKey({}))
    );

    expect(serializeTypes(record.value)).toContainString('(Color');
    expect(plan.counters).toMatchObject({
      actualParses: 1,
      fallbackFullTreeMaterializations: 0
    });
  });

  test('promotes Less mixin call islands without parsing sibling declarations', () => {
    const document = parseLessStructure('fixture.less', '.foo { .mixin(red); color: red; }');
    const registry = new IslandParserRegistry();
    registerLessIslandProviders(registry);
    const plan = new IslandParsePlan(document, registry);
    const island = document.islands('mixin-call')[0]!;
    const id = plan.requestIsland(island, 'less-mixin', lessParserConfigKey({}));

    const record = plan.execute(id);

    expect(serializeTypes(record.value)).toContainString('(Reference');
    expect(plan.counters.actualParses).toBe(1);
  });

  test('reports selected-island parse metrics without full-source promotion', () => {
    const source = '@brand: red; .foo { .mixin(@brand); color: @brand; width: 1px; }';
    const document = parseLessStructure('fixture.less', source);
    const registry = new IslandParserRegistry();
    const configKey = lessParserConfigKey({});
    registerLessIslandProviders(registry);
    const plan = new IslandParsePlan(document, registry);
    const mixinIsland = document.islands('mixin-call')[0]!;
    const referenceIsland = document.islands('variable-reference')[0]!;
    const mixinId = plan.requestIsland(mixinIsland, 'less-mixin', configKey);
    const referenceId = plan.requestIsland(referenceIsland, 'less-value', configKey);
    const selectedBytes =
      mixinIsland.end - mixinIsland.start
      + referenceIsland.end - referenceIsland.start;

    plan.execute(mixinId);
    plan.execute(referenceId);
    plan.execute(referenceId);

    expect(selectedBytes).toBeLessThan(document.source.length);
    expect(plan.counters).toMatchObject({
      requestIds: 2,
      actualParses: 2,
      cacheMisses: 2,
      cacheHits: 1,
      promotedBytes: selectedBytes,
      fallbackFullTreeMaterializations: 0
    });
  });
});
