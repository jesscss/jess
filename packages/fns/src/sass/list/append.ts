import { define, checkAny, checkKinds } from '@jesscss/core/value';
import { createSassListResult, getSassListInfo, resolveSassSeparator } from './util.js';

const append = define('append', {
  params: [
    { name: 'list', type: 'any', check: checkAny },
    { name: 'value', type: 'any', check: checkAny },
    { type: ['Quoted', 'Keyword'], check: checkKinds, name: 'separator', optional: true }
  ] as const,
  body: (list, value, separator) => {
    const info = getSassListInfo(list);
    const sep = resolveSassSeparator(separator, info.sep);
    return createSassListResult([...info.values, value], sep, info.bracketed);
  }
});

export default append;
