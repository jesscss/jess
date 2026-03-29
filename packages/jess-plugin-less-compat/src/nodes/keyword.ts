import { Keyword } from '@jesscss/core';
import { createFromAdapter, selfVisitAccept } from '../transform/adapter.js';

export const transformKeywordToLess = createFromAdapter<Keyword>({
  fields: {
    value: k => k._value
  },
  accept: selfVisitAccept()
});
