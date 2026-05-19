import { Dimension, Num } from '@jesscss/core';
import { createFromAdapter } from '../transform/adapter.js';

export const transformDimensionToLess = createFromAdapter<Dimension | Num>({
  fields: {
    value: d => d.value.number,
    unit: d => d instanceof Num ? '' : d.value.unit || ''
  }
});
