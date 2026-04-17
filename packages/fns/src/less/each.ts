import {
  Node,
  Rules,
  Mixin,
  For,
  Nil,
  Any,
  VarDeclaration,
  defineFunction,
  type FunctionThis
} from '@jesscss/core';

/**
 * Less each() — builds a For node and delegates. All loop evaluation (including
 * priorScope optimization) lives in the For node; each() is a thin wrapper.
 *
 * This is a 1-based iterator. Meaning,
 * for lists without keys, the first key is 1, not 0.
 *
 * @example
 * @-use '@jesscss/fns' as fns;
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
  async function(_this: FunctionThis, list: Node, mixin: Mixin | Rules) {
    const mixinRules = mixin.type === 'Rules' ? mixin : mixin.value.rules;
    let keys = ['value', 'key', 'index'];
    if (mixin.type === 'Mixin') {
      const { params } = mixin.value;
      if (params) {
        let paramList = params.value;
        let key0 = paramList[0]?.toTrimmedString();
        let key1 = paramList[1]?.toTrimmedString();
        let key2 = paramList[2]?.toTrimmedString();
        const parsedKeys = [key0, key1, key2];
        for (let i = 0; i < parsedKeys.length; i++) {
          if (parsedKeys[i]) {
            keys[i] = parsedKeys[i]!;
          }
        }
      }
    }
    const vars: [VarDeclaration, VarDeclaration, VarDeclaration] = [
      new VarDeclaration({
        name: new Any(keys[0], { role: 'property' }),
        value: new Nil()
      }, { paramVar: true }),
      new VarDeclaration({
        name: new Any(keys[1], { role: 'property' }),
        value: new Nil()
      }, { paramVar: true }),
      new VarDeclaration({
        name: new Any(keys[2], { role: 'property' }),
        value: new Nil()
      }, { paramVar: true })
    ];
    return new For({
      pattern: { kind: 'tuple', values: vars },
      iterable: { kind: 'node', value: list },
      rules: mixinRules
    });
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
