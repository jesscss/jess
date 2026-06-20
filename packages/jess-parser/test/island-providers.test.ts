import { describe, expect, test } from 'vitest';
import { IslandParsePlan, IslandParserRegistry } from '@jesscss/parser';
import { serializeTypes } from '@jesscss/core';
import {
  parseJessStructure,
  registerJessIslandProviders
} from '../src/index.js';

describe('Jess island providers', () => {
  test('promotes Jess selector islands without parsing sibling bodies', () => {
    const document = parseJessStructure('fixture.jess', '.foo { color: $brand; } .bar { width: 1px; }');
    const registry = new IslandParserRegistry();
    registerJessIslandProviders(registry);
    const plan = new IslandParsePlan(document, registry);
    const selectorIsland = document.islands('selector')[0]!;
    const id = plan.requestIsland(selectorIsland, 'jess-selector');

    const record = plan.execute(id);

    expect(serializeTypes(record.value)).toContainString('(BasicSelector');
    expect(record.diagnostics).toEqual([]);
    expect(plan.counters).toMatchObject({
      actualParses: 1,
      promotedBytes: selectorIsland.end - selectorIsland.start,
      fallbackFullTreeMaterializations: 0
    });
  });

  test('promotes Jess value/reference islands independently', () => {
    const document = parseJessStructure('fixture.jess', '$brand: red; .foo { color: $brand; width: $(1 + 1)px; }');
    const registry = new IslandParserRegistry();
    registerJessIslandProviders(registry);
    const plan = new IslandParsePlan(document, registry);
    const island = document.islands('variable-reference').find(candidate =>
      document.source.slice(candidate.start, candidate.end).includes('$brand')
    )!;
    const id = plan.requestIsland(island, 'jess-value');

    const record = plan.execute(id);

    expect(serializeTypes(record.value)).toContainString('(Reference');
    expect(plan.counters.actualParses).toBe(1);
  });

  test('promotes Jess control conditions without parsing the control body', () => {
    const source = '$if ($foo = bar) { .a { color: red; } } .b { color: blue; }';
    const document = parseJessStructure('fixture.jess', source);
    const registry = new IslandParserRegistry();
    registerJessIslandProviders(registry);
    const plan = new IslandParsePlan(document, registry);
    const conditionIsland = document.islands('control-condition')[0]!;
    const id = plan.requestIsland(conditionIsland, 'jess-condition');

    const record = plan.execute(id);

    expect(serializeTypes(record.value)).toContainString('(Condition');
    expect(conditionIsland.end - conditionIsland.start).toBeLessThan(source.length);
    expect(plan.counters).toMatchObject({
      requestIds: 1,
      actualParses: 1,
      promotedBytes: conditionIsland.end - conditionIsland.start,
      fallbackFullTreeMaterializations: 0
    });
  });

  test('promotes Jess module at-rule statement islands', () => {
    const document = parseJessStructure('fixture.jess', '@-compose "./base.jess"; .foo { color: red; }');
    const registry = new IslandParserRegistry();
    registerJessIslandProviders(registry);
    const plan = new IslandParsePlan(document, registry);
    const moduleIsland = document.islands('at-rule-prelude')[0]!;
    const id = plan.requestIsland(moduleIsland, 'jess-module-at-rule');

    const record = plan.execute(id);

    expect(serializeTypes(record.value)).toContainString('(StyleImport');
    expect(record.fallbackFullTree).toBe(false);
    expect(plan.counters).toMatchObject({
      actualParses: 1,
      fallbackFullTreeMaterializations: 0
    });
  });

  test('reports selected-island parse metrics without full-source promotion', () => {
    const source = '$brand: red; .foo { color: $brand; width: $(1 + 1)px; }\n.bar { color: blue; }';
    const document = parseJessStructure('fixture.jess', source);
    const registry = new IslandParserRegistry();
    registerJessIslandProviders(registry);
    const plan = new IslandParsePlan(document, registry);
    const selectorIsland = document.islands('selector')[0]!;
    const valueIsland = document.islands('declaration-value')[1]!;
    const selectorId = plan.requestIsland(selectorIsland, 'jess-selector');
    const valueId = plan.requestIsland(valueIsland, 'jess-value');
    const selectedBytes =
      selectorIsland.end - selectorIsland.start +
      valueIsland.end - valueIsland.start;

    plan.execute(selectorId);
    plan.execute(valueId);
    plan.execute(valueId);

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
