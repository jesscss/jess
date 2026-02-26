import {
  List,
  Node,
  Paren,
  Sequence,
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
import { syncLog } from '@jesscss/core/debug-log';

let eachInjectionProbeCount = 0;

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
    // #region agent log
    fetch('http://127.0.0.1:7246/ingest/5495253d-8cd1-42e7-9850-458424cd0fb8', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Debug-Session-Id': '34ceef'
      },
      body: JSON.stringify({
        sessionId: '34ceef',
        runId: 'each-escaped-paren',
        hypothesisId: 'H_each_1_H_each_2',
        location: 'packages/fns/src/less/each.ts:entry',
        message: 'each() entry list shape',
        data: {
          listType: list?.type ?? null,
          isParen: list instanceof Paren,
          parenEscaped: list instanceof Paren ? !!list.options?.escaped : false,
          parenInnerType: list instanceof Paren && list.value ? list.value.type : null,
          isList: list instanceof List,
          isSequence: list instanceof Sequence
        },
        timestamp: Date.now()
      })
    }).catch(() => {});
    // #endregion
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
      // #region agent log
      fetch('http://127.0.0.1:7246/ingest/5495253d-8cd1-42e7-9850-458424cd0fb8', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Debug-Session-Id': '34ceef'
        },
        body: JSON.stringify({
          sessionId: '34ceef',
          runId: 'each-escaped-paren',
          hypothesisId: 'H_each_3',
          location: 'packages/fns/src/less/each.ts:iteration',
          message: 'each() iteration value shape',
          data: {
            keyType: key instanceof Node ? key.type : typeof key,
            keyValue: key instanceof Node ? key.valueOf?.() : key,
            valueType: value instanceof Node ? value.type : typeof value,
            valueString: value instanceof Node ? value.toString({ context: this.context }) : String(value)
          },
          timestamp: Date.now()
        })
      }).catch(() => {});
      // #endregion
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
      if (eachInjectionProbeCount < 20) {
        eachInjectionProbeCount++;
        const firstThree = clone.value.slice(0, 3).map((n) => {
          if (n instanceof VarDeclaration) {
            return n.value.name.toTrimmedString();
          }
          return n.type;
        });
        // #region agent log
        syncLog({
          sessionId: process.env.DEBUG_SESSION_ID,
          runId: 'interpolated-recursion',
          hypothesisId: 'H41',
          location: 'packages/fns/src/less/each.ts:each',
          message: 'each() injected iteration bindings',
          data: {
            indexValue: index - 1,
            keyType: key instanceof Node ? key.type : typeof key,
            keyStrType: keyStr instanceof Node ? keyStr.type : typeof keyStr,
            valueType: value instanceof Node ? value.type : typeof value,
            firstThree
          },
          timestamp: Date.now()
        });
        // #endregion
      }
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