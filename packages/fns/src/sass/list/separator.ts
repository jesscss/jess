import { makeKeyword, define, checkAny } from '@jesscss/core/value';
import { getSassListInfo } from './util.js';

const separator = define('separator', {
  params: [{ name: 'list', type: 'any', check: checkAny }] as const,
  body: (list) => {
    const sep = getSassListInfo(list).sep;
    return makeKeyword(sep === ',' ? 'comma' : sep === '/' ? 'slash' : 'space');
  }
});

export default separator;
