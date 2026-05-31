import { describe, expect, it } from 'vitest';
import { any } from '../../any.js';
import { createPlacementChildSegment } from '../placement-state.js';

describe('placement state vocabulary', () => {
  it('creates source/output child segments with shared field names', () => {
    const source = any('source');
    const output = any('output');

    expect(createPlacementChildSegment(source, output, 2)).toEqual({
      kind: 'source-child',
      source,
      output,
      index: 2
    });
  });
});
