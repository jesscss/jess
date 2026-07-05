import { Extend, ExtendFlag, Selector, sourceSpanOf } from '@jesscss/core';
import { createFromAdapter, selfVisitAccept } from '../transform/adapter.js';
import { toLessNode } from '../transform/to-less.js';

export const transformExtendToLess = createFromAdapter<Extend>({
  fields: {
    selector: (e, cache) => {
      const selector = e.selector;
      return selector instanceof Selector ? toLessNode(selector, { cache }) : selector;
    },
    option: e => e.flag === ExtendFlag.Exact ? 'exact' : 'all',
    index: e => sourceSpanOf(e)?.start
  },
  accept: selfVisitAccept()
});
