import { Quoted, Any, Interpolated } from '@jesscss/core';
import { createFromAdapter, selfVisitAccept } from '../transform/adapter.js';

export const transformQuotedToLess = createFromAdapter<Quoted>({
  fields: {
    value: (q) => {
      const value = q.value;
      if (typeof value === 'string') {
        return value;
      }
      if (value instanceof Any) {
        return value.value;
      }
      if (value instanceof Interpolated) {
        return String(value.value.source);
      }
      return String(value);
    },
    quote: q => q.options.quote || '"',
    escaped: q => q.options.escaped === true
  },
  accept: selfVisitAccept()
});
