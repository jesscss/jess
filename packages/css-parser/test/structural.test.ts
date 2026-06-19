import { describe, expect, test } from 'vitest';
import { serializeTypes } from '@jesscss/core';
import {
  cssIslandParsePlan,
  parseCssStructure
} from '../src/index.js';

describe('CSS structural services', () => {
  test('parses CSS structure and materializes CSS islands through css-parser exports', () => {
    const document = parseCssStructure('fixture.css', '.foo { color: red; }');
    expect(document.source.filePath).toBe('fixture.css');
    expect(document.islands('selector')[0]).toMatchObject({
      islandKind: 'selector',
      start: 0,
      end: 4
    });

    const plan = cssIslandParsePlan('fixture.css', document.source.text);
    const id = plan.requestIsland(plan.document.islands('selector')[0]!, 'css-selector');
    const record = plan.execute(id);

    expect(serializeTypes(record.value)).toContainString("(BasicSelector '.foo')");
    expect(record.fallbackFullTree).toBe(false);
    expect(plan.counters.actualParses).toBe(1);
  });
});
