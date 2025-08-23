import {
  List,
  Node,
  Rules,
  Mixin,
  Any,
  getFunctionFromMixins,
  getEntries,
  defineFunction
} from '@jesscss/core';

/**
 * This is a 1-based iterator. Meaning,
 * for lists without keys, the first key is 1, not 0.
 *
 * @example
 * @-from '@jesscss/fns' import (each);
 * @-let list: 1, 2, 3;
 * @-mixin iterate (value, key) {
 *   .icon-#($value) {
 *     width: $value;
 *     height: $key;
 *   }
 * }
 * $each(list, iterate);
 */
const each = defineFunction(
  'each',
  async function(this: any, list: Node, mixin: Mixin | Rules) {
    let entries = getEntries(list);
    /** If a Node is not list-like, wrap it */
    if (mixin instanceof Rules) {
      mixin = new Mixin({
        params: new List([
          new Any('value', { role: 'name' }),
          new Any('key', { role: 'name' }),
          new Any('index', { role: 'name' })
        ]),
        rules: mixin
      });
    }
    const func = getFunctionFromMixins(mixin).bind(this);

    const rule = new Rules([]);
    const rules = rule.value;

    let index = 1;

    for (let [key, value] of entries) {
      let keyStr = typeof key === 'number' ? `${key + 1}` : key;
      let outputRules = await func(value, keyStr, index++);
      rules.push(outputRules);
    }

    return rules;
  },
  {
    params: [{
      name: 'list',
      type: Node
    }, {
      name: 'mixin',
      type: [Mixin, Rules]
    }]
  }
);

export default each;