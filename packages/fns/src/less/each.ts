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
  async function(this: FunctionThis, list: Node, mixin: Mixin | Rules) {
    const rawMixinRules = mixin instanceof Rules ? mixin : mixin.data.rules;
    // Preserve callback lexical scope for variable lookups used in each bodies.
    let mixinRules = rawMixinRules.copy(true).inherit(rawMixinRules);
    mixinRules.sourceParent = mixin.sourceParent ?? mixin.parent ?? mixinRules.sourceParent;
    let keys = ['value', 'key', 'index'];
    if (mixin instanceof Mixin) {
      let params = mixin.data.params;
      if (params) {
        let paramList = params.data;
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
    const vars = keys.map(name => new VarDeclaration({
      name: new Any(name, { role: 'property' }),
      value: new Nil()
    }, { paramVar: true }));
    return new For({
      vars,
      iterable: list,
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