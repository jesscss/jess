import { Dimension, Num } from '@jesscss/core';
import { createFromAdapter } from '../transform/adapter.js';

export const transformDimensionToLess = createFromAdapter<Dimension | Num>({
  fields: {
    value: d => d.number,
    unit: d => d instanceof Num ? '' : (d as Dimension).unit || ''
  }
});
