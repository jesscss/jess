import { describe, expect, test, vi } from 'vitest';
import { Node, serializeTypes } from '@jesscss/core';
import { LessPlugin } from '../src/index.js';

describe('LessPlugin structural activation', () => {
  test('binds Less structure and island providers to the plugin extension', () => {
    const plugin = new LessPlugin({ mathMode: 'always' });
    const activation = plugin.structuralActivation();

    expect(activation.profile.name).toBe('less');
    expect(activation.supportedExtensions).toEqual(['.less']);

    const document = plugin.structureParse('fixture.less', '.foo:extend(.bar) { color: @brand; }');
    expect(document.source.filePath).toBe('fixture.less');
    expect(document.islands('extend-candidate')).toHaveLength(1);

    const plan = plugin.islandParsePlan('fixture.less', document.source.text);
    const id = plan.requestIsland(plan.document.islands('extend-candidate')[0]!, 'less-selector', {
      leakyRules: true,
      looseMode: true,
      mathMode: 'always',
      wrapOuterExpressions: true
    });

    const record = plan.execute(id);

    expect(serializeTypes(record.value)).toContainString('(Extend');
    expect(record.fallbackFullTree).toBe(false);
    expect(plan.counters.actualParses).toBe(1);
  });

  test('answers structural-only queries without core visitor traversal or materialization', () => {
    const accept = vi.spyOn(Node.prototype, 'accept');
    try {
      const plugin = new LessPlugin();
      const document = plugin.structureParse(
        'fixture.less',
        '.foo { @brand: blue; color: @brand; .bar { width: 1px; } }'
      );
      const plan = plugin.islandParsePlan('fixture.less', document.source.text);

      expect(document.foldingRanges().length).toBeGreaterThan(0);
      expect(document.symbols().length).toBeGreaterThan(0);
      expect(document.findNodeAt(document.source.text.indexOf('color'))?.kind).toBe('declaration');
      expect(plan.requestNode(document.root, 'less-value')).toEqual([]);
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
