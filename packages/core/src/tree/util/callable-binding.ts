import { F_STATIC, Node } from '../node.js';
import { Sequence } from '../sequence.js';
import { copyWithReusableLeaves, hasNodeChild } from './cloning.js';

export function canReuseBoundValue(value: Node): boolean {
  return (value.frozen || value.hasFlag(F_STATIC))
    && value.location.length === 0
    && !hasNodeChild(value.value);
}

export function cloneBoundValue(value: Node): Node {
  if (canReuseBoundValue(value)) {
    return value;
  }
  const boundValue = copyWithReusableLeaves(value).detachTrivia(true);
  boundValue.frozen = true;
  return boundValue;
}

export function createRestBindingValue(args: Node[]): Sequence {
  return new Sequence(args.map(restArg => cloneBoundValue(restArg)));
}

export function createArgumentsBindingValue(args: Node[]): Sequence {
  const value = new Sequence([]);
  value.value.push(...args);
  return value;
}
