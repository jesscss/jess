import { defineFunction } from '@jesscss/core';
import { createSassListResult, getSassListInfo, resolveSassSeparator } from './util.js';

const append = defineFunction('append', {
  params: [
    { name: 'list', type: 'any' },
    { name: 'value', type: 'any' },
    { name: 'separator', type: ['Quoted', 'Keyword'], optional: true }
  ] as const,
  body: (list, value, separator) => {
    const info = getSassListInfo(list);
    const sep = resolveSassSeparator(separator, info.sep);
    return createSassListResult([...info.values, value], sep, info.bracketed);
  }
});

export default append;
