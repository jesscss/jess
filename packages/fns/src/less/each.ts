import {
  Node,
  Rules,
  Mixin,
  For,
  Sequence,
  Paren,
  List,
  Block,
  Nil,
  Any,
  VarDeclaration,
  defineFunction,
  type FunctionThis
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
    let mixinRules = mixin instanceof Rules ? mixin : mixin.value.rules;
    const keys = ['value', 'key', 'index'];
    if (mixin instanceof Mixin) {
      let params = mixin.value.params;
      if (params) {
        let paramList = params.value;
        let key0 = paramList[0]?.toTrimmedString();
        let key1 = paramList[1]?.toTrimmedString();
        let key2 = paramList[2]?.toTrimmedString();
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
    const vars = keys.map(name => new VarDeclaration({
      name: new Any(name, { role: 'property' }),
      value: new Nil()
    }, { paramVar: true }));
    const pattern = new Block(
      new List(vars, { sep: ',' }),
      { type: 'square' }
    );
    const header = new Sequence([
      new Paren(new Sequence([
        pattern,
        new Any('of', { role: 'any' }),
        list
      ]))
    ]);
    return new For({ header, rules: mixinRules });
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