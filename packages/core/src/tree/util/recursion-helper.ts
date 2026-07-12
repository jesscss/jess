import type { Call } from '../call.js';
import type { List } from '../list.js';

type CallItem = List | string | undefined;
export type CallSignature = List | string | undefined;
/**
 * This memoizes arguments for a call and returns true
 * if the call has called itself with the same arguments.
 *
 * It lazily indexes the arguments when there's a subsequent
 * call.
 */
export class CallMap {
  private _callMap = new Map<Call, [CallItem, ...CallItem[]]>();

  add(call: Call, args: CallSignature) {
    let set = this._callMap.get(call);
    if (!set) {
      this._callMap.set(call, [args]);
    } else {
      if (args === undefined && set.includes(undefined)) {
        return true;
      }
      let argsValue = args?.valueOf();

      for (let i = 0; i < set.length; i++) {
        let item = set[i];
        if (item === undefined) {
          continue;
        }
        let itemValue = item.valueOf();
        if (itemValue === argsValue) {
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
