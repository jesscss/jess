import { Combinator } from '@jesscss/core';
import { createFromAdapter } from '../transform/adapter.js';

export const transformCombinatorToLess = createFromAdapter<Combinator>({
  fields: {
    value: c => c._value
  }
});
