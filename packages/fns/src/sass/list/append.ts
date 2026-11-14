import { define, checkAny, checkKinds, optional } from '@jesscss/core/value';
import { createSassListResult, getSassListInfo, resolveSassSeparator } from './util.js';

const append = define('append', {
  params: [
    { name: 'list', type: 'any', check: checkAny },
    { name: 'value', type: 'any', check: checkAny },
    /* @__PURE__ */ optional({ type: ['Quoted', 'Keyword'], check: checkKinds, name: 'separator' })
  ] as const,
  body: (list, value, separator) => {
    const info = getSassListInfo(list);
    const sep = resolveSassSeparator(separator, info.sep);
    return createSassListResult([...info.values, value], sep, info.bracketed);
  }
});

export default append;
