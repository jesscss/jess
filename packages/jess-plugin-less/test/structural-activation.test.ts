import { describe, expect, test } from 'vitest';
import { serializeTypes } from '@jesscss/core';
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
});
