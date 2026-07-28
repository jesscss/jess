import { sourceSpanOf } from './provenance.js';
import { F_HAS_NODE_CHILD, F_STATIC, Node } from '../node.js';
import { N } from '../node-type.js';
import { isNode } from './is-node.js';
import { Sequence } from '../sequence.js';

function canReuseStaticScalarLeaf(value: Node): boolean {
  return value.hasFlag(F_STATIC)
    && (sourceSpanOf(value) === undefined)
    && !value.hasFlag(F_HAS_NODE_CHILD);
}

export function cloneBoundValue(value: Node): Node {
  if (canReuseStaticScalarLeaf(value)) {
    return value;
  }

  /*
   * Detached-ruleset arg-binding fold: a Rules passed AS a mixin argument is a
   * lexical closure whose free-var scope is already captured on the evaluated
   * surface (`_closureScope`, set in evaluateCallableArgs BEFORE binding). The
   * placement clone here only produced a fresh derive surface — the eval-route
   * marker — without adding isolation the closure/call path needs. Bind the
   * captured surface directly (same as the VarDeclaration DR path), which the
   * no-clone `@alias()` call site already relies on. Keeps `deriveCalls` off the
   * DR-as-arg path and folds it onto the spine.
   */
  if (isNode(value, N.Rules)) {
    return value;
  }
  return value.cloneForPlacement().detachTrivia(true);
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
