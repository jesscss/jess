import { defineFunction, makeKeyword } from '@jesscss/core/value';
import { getSassListInfo } from './util.js';

const separator = defineFunction('separator', {
  params: [{ name: 'list', kinds: 'any' }] as const,
  body: (list) => {
    const sep = getSassListInfo(list).sep;
    return makeKeyword(sep === ',' ? 'comma' : sep === '/' ? 'slash' : 'space');
  }
});

export default separator;
