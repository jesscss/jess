import {
  List,
  Node,
  Rules,
  Mixin,
  Any,
  Num,
  getEntries,
  defineFunction,
  type FunctionThis,
  Declaration,
  VarDeclaration
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
  async function(this: FunctionThis, list: Node, mixin: Mixin | Rules) {
    let entries = getEntries(list);
    /** If a Node is not list-like, wrap it */

    let accumulatedNodes: Node[] = [];
    let mixinRules = mixin instanceof Rules ? mixin : mixin.value.rules;

    let index = 1;
    let keys = ['value', 'key', 'index'];
    if (mixin instanceof Mixin) {
      let params = mixin.value.params;
      if (params) {
        let list = params.value;
        let key0 = list[0]?.toTrimmedString();
        let key1 = list[1]?.toTrimmedString();
        let key2 = list[2]?.toTrimmedString();
        if (key2) {
          keys[2] = key2;
          keys[1] = key1!;
          keys[0] = key0!;
        } else if (key1) {
          keys[1] = key1;
          keys[0] = key0!;
        } else if (key0) {
          keys[0] = key0;
        }
      }
    }

    for (let [value, key] of entries) {
      let clone = mixinRules.clone(true);
      let keyStr = typeof key === 'number' ? `${key + 1}` : key;
      clone.value.unshift(new VarDeclaration({
        name: new Any('index', { role: 'property' }),
        value: new Num(index)
      }));
      index++;
      clone.value.unshift(new VarDeclaration({
        name: new Any('key', { role: 'property' }),
        value: keyStr instanceof Node ? await keyStr.eval(this.context) : new Any(keyStr)
      }));
      clone.value.unshift(new VarDeclaration({
        name: new Any('value', { role: 'property' }),
        value: await value.eval(this.context)
      }));
      let result = await clone.eval(this.context);
      if (result instanceof Rules) {
        accumulatedNodes.push(...result.value);
      } else {
        accumulatedNodes.push(result);
      }
    }

    return new Rules(accumulatedNodes);
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