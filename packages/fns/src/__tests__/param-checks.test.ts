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

const PLAIN = new Set<unknown>([...Object.values(CHECKS), checkKinds]);

describe('parameter checks', () => {
  const params = [...lessFns, ...sassFns].flatMap(fn => fn.params.map((param, index) => [`${fn.name} ${index}`, param] as const));

  it.each(params.filter(([, param]) => param.optional !== true && param.rest !== true && param.lazy !== true && param.default === undefined))('%s names the check of its type', (_, param) => {
    expect(param.check).toBe(typeof param.type === 'string' ? CHECKS[param.type] ?? checkKinds : checkKinds);
  });

  /* A flag without its wrapper would bind one plain value: `optional: true` over `checkColor` throws on a left-out argument. */
  it.each(params.filter(([, param]) => param.optional === true || param.rest === true))('%s binds through the wrapper its flag names', (_, param) => {
    expect(PLAIN.has(param.check)).toBe(false);
    const bound = param.check!('f', 0, undefined, undefined, param.type, []);
    expect(bound).toEqual(param.rest === true ? [] : undefined);
  });
});
