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
    const rawMixinRules = mixin instanceof Rules ? mixin : mixin.value.rules;
    // Preserve callback lexical scope for variable lookups used in each bodies.
    let mixinRules = rawMixinRules.copy(true).inherit(rawMixinRules);
    mixinRules.sourceParent = mixin.sourceParent ?? mixin.parent ?? mixinRules.sourceParent;
    let keys = ['value', 'key', 'index'];
    if (mixin instanceof Mixin) {
      let params = mixin.value.params;
      if (params) {
        let paramList = params.value;
        let key0 = paramList[0]?.toTrimmedString();
        let key1 = paramList[1]?.toTrimmedString();
        let key2 = paramList[2]?.toTrimmedString();
        const parsedKeys = [key0, key1, key2].filter((k): k is string => !!k);
        if (parsedKeys.length > 0) {
          // For named callback params, use exactly the provided arity.
          // Less callbacks often use 1-3 params; keeping defaults beyond arity
          // can create duplicate names (e.g. .(@val, @index) => index/index).
          keys = parsedKeys;
        }
      }
    }
    const vars = keys.map(name => new VarDeclaration({
      name: new Any(name, { role: 'property' }),
      value: new Nil()
    }, { paramVar: true }));
    return new For({
      pattern: {
        kind: 'tuple',
        values: vars as [VarDeclaration, ...VarDeclaration[]]
      },
      iterable: {
        kind: 'node',
        value: list
      },
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