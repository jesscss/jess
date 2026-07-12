import { Extend, ExtendFlag, Selector } from '@jesscss/core';
import { createFromAdapter, selfVisitAccept } from '../transform/adapter.js';
import { toLessNode } from '../transform/to-less.js';

export const transformExtendToLess = createFromAdapter<Extend>({
  fields: {
    selector: (e, cache) => {
      const selector = e.get('selector');
      return selector instanceof Selector ? toLessNode(selector, { cache }) : selector;
    },
    option: e => e.get('flag') === ExtendFlag.Exact ? 'exact' : 'all',
    index: (e) => {
      const loc = e.location;
      return loc.length ? loc[0] : undefined;
    }
  },
  accept: selfVisitAccept()
});
