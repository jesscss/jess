import { describe, expect, test } from 'vitest';
import { IslandParsePlan, IslandParserRegistry } from '@jesscss/parser/services/index';
import { serializeTypes } from '@jesscss/core';
import { parseCssStructure, registerCssIslandProviders } from '../src/index.js';

describe('CSS island providers', () => {
  test('promotes selector islands without parsing sibling islands', () => {
    const document = parseCssStructure('fixture.css', '.foo { color: red; width: 1px; }');
    const registry = new IslandParserRegistry();
    registerCssIslandProviders(registry);
    const plan = new IslandParsePlan(document, registry);
    const selectorIsland = document.islands('selector')[0]!;
    const id = plan.requestIsland(selectorIsland, 'css-selector');

    const record = plan.execute(id);

    expect(serializeTypes(record.value)).toContainString('(BasicSelector');
    expect(record.diagnostics).toEqual([]);
    expect(plan.counters).toMatchObject({
      actualParses: 1,
      promotedBytes: selectorIsland.end - selectorIsland.start
    });
  });

  test('promotes declaration value islands independently', () => {
    const document = parseCssStructure('fixture.css', '.foo { color: red; width: 1px; }');
    const registry = new IslandParserRegistry();
    registerCssIslandProviders(registry);
    const plan = new IslandParsePlan(document, registry);
    const valueIsland = document.islands('declaration-value')[0]!;
    const id = plan.requestIsland(valueIsland, 'css-value');

    const record = plan.execute(id);

    expect(serializeTypes(record.value)).toContainString('(Color');
    expect(plan.counters.actualParses).toBe(1);
  });

  test('reports selected-island parse metrics without full-source promotion', () => {
    const source = '.foo { color: red; width: 1px; }\n.bar { margin: 0; padding: 2px; }';
    const document = parseCssStructure('fixture.css', source);
    const registry = new IslandParserRegistry();
    registerCssIslandProviders(registry);
    const plan = new IslandParsePlan(document, registry);
    const selectorIsland = document.islands('selector')[0]!;
    const valueIsland = document.islands('declaration-value')[1]!;
    const selectorId = plan.requestIsland(selectorIsland, 'css-selector');
    const valueId = plan.requestIsland(valueIsland, 'css-value');
    const selectedBytes =
      selectorIsland.end - selectorIsland.start
      + valueIsland.end - valueIsland.start;

    plan.execute(selectorId);
    plan.execute(valueId);
    plan.execute(selectorId);

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
