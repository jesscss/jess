import type { Call } from '../call.js';
import type { List } from '../list.js';
import type { Context } from '../../context.js';
import { isNode } from './is-node.js';

type CallItem = string | undefined;

function getCallArgsSignature(args: List | undefined, context?: Context): string | undefined {
  if (!isNode(args)) {
    return undefined;
  }
  return args.toTrimmedString(context ? { context } : undefined);
}
/**
 * This memoizes arguments for a call and returns true
 * if the call has called itself with the same arguments.
 *
 * It lazily indexes the arguments when there's a subsequent
 * call.
 */
export class CallMap {
  private _callMap = new Map<Call, [CallItem, ...CallItem[]]>();

  add(call: Call, args: List | undefined, context?: Context) {
    let set = this._callMap.get(call);
    const argsSignature = getCallArgsSignature(args, context);
    if (!set) {
      this._callMap.set(call, [argsSignature]);
    } else {
      if (argsSignature === undefined && set.includes(undefined)) {
        return true;
      }
      for (let i = 0; i < set.length; i++) {
        let item = set[i]!;
        if (item === argsSignature) {
          return true;
        }
      }
    }
    return false;
  }

  delete(call: Call) {
    let set = this._callMap.get(call);
    if (set) {
      set.pop();
      if (set.length === 0) {
        this._callMap.delete(call);
      }
      return true;
    }
    return false;
  }
}
