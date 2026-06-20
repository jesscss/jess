import { describe, expect, test, vi } from 'vitest';
import { Node, serializeTypes } from '@jesscss/core';
import { ScssPlugin } from '../src/index.js';

describe('ScssPlugin structural activation', () => {
  test('binds SCSS structure and island providers to the plugin extension', () => {
    const plugin = new ScssPlugin();
    const activation = plugin.structuralActivation();

    expect(activation.profile.name).toBe('scss');
    expect(activation.supportedExtensions).toEqual(['.scss']);

    const document = plugin.structureParse('fixture.scss', '@if $enabled { .foo { color: $brand; } }');
    expect(document.source.filePath).toBe('fixture.scss');
    expect(document.islands('control-condition')).toHaveLength(1);

    const plan = plugin.islandParsePlan('fixture.scss', document.source.text);
    const id = plan.requestIsland(plan.document.islands('control-condition')[0]!, 'scss-condition');

    const record = plan.execute(id);

    expect(serializeTypes(record.value)).toContainString('(Reference');
    expect(serializeTypes(record.value)).toContainString('key: \'enabled\'');
    expect(record.fallbackFullTree).toBe(false);
    expect(plan.counters.actualParses).toBe(1);
  });

  test('answers structural-only queries without core visitor traversal or materialization', () => {
    const accept = vi.spyOn(Node.prototype, 'accept');
    try {
      const plugin = new ScssPlugin();
      const document = plugin.structureParse(
        'fixture.scss',
        '@if $enabled { .foo { color: $brand; } }'
      );
      const plan = plugin.islandParsePlan('fixture.scss', document.source.text);

      expect(document.foldingRanges().length).toBeGreaterThan(0);
      expect(document.symbols().length).toBeGreaterThan(0);
      expect(document.findNodeAt(document.source.text.indexOf('color'))?.kind).toBe('declaration');
      expect(plan.requestNode(document.root, 'scss-value')).toEqual([]);
      expect(plan.counters).toMatchObject({
        actualParses: 0,
        fallbackFullTreeMaterializations: 0,
        structuralOnlyQueries: 1
      });
      expect(accept).not.toHaveBeenCalled();
    } finally {
      accept.mockRestore();
    }
  });
});
