import { checkAny, checkBlock, checkBool, checkCollection, checkColor, checkDimension, checkKeyword, checkKinds, checkList, checkNull, checkQuoted, checkUrl, type Check } from '@jesscss/core/value';
import { describe, expect, it } from 'vitest';
import { lessFns } from '../less/registry.js';
import { sassFns } from '../sass/registry.js';

/** The check a parameter of one value type names; a parameter of several names `checkKinds`. */
const CHECKS: Readonly<Record<string, Check>> = {
  any: checkAny,
  Dimension: checkDimension,
  Color: checkColor,
  Keyword: checkKeyword,
  Quoted: checkQuoted,
  Bool: checkBool,
  Null: checkNull,
  List: checkList,
  Url: checkUrl,
  Block: checkBlock,
  Collection: checkCollection
};

describe('parameter checks', () => {
  it.each([...lessFns, ...sassFns].flatMap(fn => fn.params.map((param, index) => [`${fn.name} ${index}`, param] as const)))('%s names the check of its type', (_, param) => {
    expect(param.check).toBe(typeof param.type === 'string' ? CHECKS[param.type] ?? checkKinds : checkKinds);
  });
});
