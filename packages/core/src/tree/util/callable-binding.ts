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
  const restArgs = new Array<Node>(args.length);
  for (let i = 0; i < args.length; i++) {
    restArgs[i] = cloneBoundValue(args[i]!);
  }
  return new Sequence(restArgs);
}

export function createArgumentsBindingValue(args: Node[]): Sequence {
  const value = new Sequence([]);
  for (let i = 0; i < args.length; i++) {
    value.value.push(args[i]!);
  }
  return value;
}

export function getArgumentsBindingValues(args: Node[]): Node[] {
  const argumentNodes: Node[] = [];
  for (let i = 0; i < args.length; i++) {
    const argNode = args[i]!;
    if (argNode instanceof Sequence) {
      for (let j = 0; j < argNode.value.length; j++) {
        argumentNodes.push(argNode.value[j]!);
      }
    } else {
      argumentNodes.push(argNode);
    }
  }
  return argumentNodes;
}
