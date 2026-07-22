import { defineFunction } from '@jesscss/core/value';
import { createSassListResult, getSassListInfo, resolveSassSeparator } from './util.js';

const append = defineFunction('append', {
  params: [
    { name: 'list', kinds: 'any' },
    { name: 'value', kinds: 'any' },
    { name: 'separator', kinds: ['Quoted', 'Keyword'], optional: true }
  ] as const,
  body: (list, value, separator) => {
    const info = getSassListInfo(list);
    const sep = resolveSassSeparator(separator, info.sep);
    return createSassListResult([...info.values, value], sep, info.bracketed);
  }
});

export default append;
