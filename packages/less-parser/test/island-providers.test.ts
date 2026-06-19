import { describe, expect, test } from 'vitest';
import { IslandParsePlan, IslandParserRegistry } from '@jesscss/parser';
import { serializeTypes } from '@jesscss/core';
import {
  parseLessStructure,
  lessParserConfigKey,
  registerLessIslandProviders
} from '../src/index.js';

describe('Less island providers', () => {
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
});
