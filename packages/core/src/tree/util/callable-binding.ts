import { F_STATIC, Node } from '../node.js';
import { Sequence } from '../sequence.js';
import { copyWithReusableLeaves } from './cloning.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function hasDirectNodeChild(value: unknown): boolean {
  if (value instanceof Node) {
    return true;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      if (value[i] instanceof Node) {
        return true;
      }
    }
    return false;
  }
  if (!isRecord(value)) {
    return false;
  }
  for (const key in value) {
    if (value[key] instanceof Node) {
      return true;
    }
  }
  return false;
}

function canReuseStaticScalarLeaf(value: Node): boolean {
  return value.hasFlag(F_STATIC)
    && value.location.length === 0
    && !hasDirectNodeChild(value.value);
}

export function cloneBoundValue(value: Node): Node {
  if (canReuseStaticScalarLeaf(value)) {
    return value;
  }
  return copyWithReusableLeaves(value).detachTrivia(true);
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
