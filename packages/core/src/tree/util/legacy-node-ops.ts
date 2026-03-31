import type { Context } from '../../context.js';
import { type Node, type NodeValue } from '../node-base.js';

const { isArray } = Array;

export function materializeEvaluatedCopy<T extends Node>(node: T, _ctx?: Context): T {
  return node as T;
}

function cloneDetachedShallowWrapper<T extends Node>(node: T, ctx?: Context): T {
  const ck = (node.constructor as typeof Node).childKeys;
  const sharedChildren: Array<{
    child: Node;
    canonicalParent: Node | undefined;
    stateParent: Node | undefined;
  }> = [];

  if (Array.isArray(ck)) {
    for (const key of ck) {
      const field = (node as unknown as Record<string, unknown>)[key!];
      if (field instanceof Node) {
        sharedChildren.push({
          child: field,
          canonicalParent: field.parent,
          stateParent: ctx?.activeState.peek(field)?._fields?.get('parent') as Node | undefined
        });
      } else if (isArray(field)) {
        for (const item of field as unknown[]) {
          if (item instanceof Node) {
            sharedChildren.push({
              child: item,
              canonicalParent: item.parent,
              stateParent: ctx?.activeState.peek(item)?._fields?.get('parent') as Node | undefined
            });
          }
        }
      }
    }
  }

  const wrapper = node.clone(false, undefined, ctx) as T;

  for (const { child, canonicalParent, stateParent } of sharedChildren) {
    (child as unknown as { parent?: Node }).parent = canonicalParent;
    if (ctx) {
      const ns = ctx.activeState.peek(child);
      if (ns?._fields?.has('parent')) {
        if (stateParent !== undefined) {
          ns._fields!.set('parent', stateParent);
        } else if (ns._fields!.get('parent') === wrapper) {
          ns._fields!.delete('parent');
        }
      }
    }
  }

  return wrapper;
}

export function cloneDetachedMaterializedWrapper<T extends Node>(node: T, ctx: Context): T {
  const wrapper = cloneDetachedShallowWrapper(node, ctx);
  const ck = (node.constructor as typeof Node).childKeys;

  if (!Array.isArray(ck)) {
    return wrapper;
  }

  const materializeValue = (value: unknown): unknown => {
    if (value instanceof Node) {
      return materializeEvaluatedCopy(value, ctx);
    }
    if (isArray(value)) {
      return value.map(item => materializeValue(item));
    }
    return value;
  };

  if (ck.length === 1) {
    const key = ck[0]!;
    wrapper.setData(materializeValue((wrapper as unknown as Record<string, unknown>)[key]) as NodeValue);
    return wrapper;
  }

  for (const key of ck) {
    wrapper.setData(key!, materializeValue((wrapper as unknown as Record<string, unknown>)[key!]));
  }

  return wrapper;
}
