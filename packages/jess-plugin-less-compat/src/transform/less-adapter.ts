import { Node } from '@jesscss/core';
import { mapJessTypeToLessType } from './type-map.js';

const LESS_ADAPTER_SYMBOL = Symbol('less-adapter');
const JESS_NODE_SYMBOL = Symbol('jess-node');
const ACTIVE_ADAPTATIONS = new WeakSet<Node>();

export const IS_ADAPTING_SYMBOL = Symbol('is-adapting');

export type LessAdapterField<T extends Node> =
  | ((node: T, cache?: WeakMap<Node, unknown>) => unknown)
  | {
    get: (node: T, cache?: WeakMap<Node, unknown>) => unknown;
    set?: (node: T, value: unknown, cache?: WeakMap<Node, unknown>) => void;
    enumerable?: boolean;
  };

export interface LessAdapterDefinition<T extends Node> {
  lessType?: string | ((node: T) => string);
  fields?: Record<string, LessAdapterField<T>>;
  accept?: (node: T, visitor: any, cache?: WeakMap<Node, unknown>) => any;
}

export type LessAdapterInstance<T extends Node = Node> = LessAdapterBase<T> & {
  type: string;
  typeIndex: number | undefined;
  accept(visitor: unknown): T | unknown;
};

function getLessTypeIndex(_lessType: string): number | undefined {
  return undefined;
}

function normalizeField<T extends Node>(
  field: LessAdapterField<T>
): Exclude<LessAdapterField<T>, Function> {
  if (typeof field === 'function') {
    return { get: field };
  }
  return field;
}

export class LessAdapterBase<T extends Node = Node> {
  readonly [LESS_ADAPTER_SYMBOL] = true;
  readonly [JESS_NODE_SYMBOL]: T;
  declare readonly ['__jessNode']: T;

  constructor(node: T) {
    this[JESS_NODE_SYMBOL] = node;
    Object.defineProperty(this, '__jessNode', {
      enumerable: false,
      configurable: false,
      writable: false,
      value: node
    });
  }

  get jessNode(): T {
    return this.__jessNode;
  }
}

class LessNodeAdapter<T extends Node> extends LessAdapterBase<T> {
  declare readonly type: string;
  declare readonly typeIndex: number | undefined;
  declare readonly accept: (visitor: unknown) => T | unknown;
  private readonly lessType: string | ((node: T) => string) | undefined;
  private readonly cache: WeakMap<Node, unknown> | undefined;
  private readonly acceptImpl: ((node: T, visitor: any, cache?: WeakMap<Node, unknown>) => any) | undefined;

  constructor(
    node: T,
    definition: LessAdapterDefinition<T>,
    cache?: WeakMap<Node, unknown>
  ) {
    super(node);
    this.lessType = definition.lessType;
    this.cache = cache;
    this.acceptImpl = definition.accept;

    Object.defineProperties(this, {
      type: {
        enumerable: true,
        configurable: true,
        get: () => {
          if (typeof this.lessType === 'function') {
            return this.lessType(this.jessNode);
          }
          return this.lessType ?? mapJessTypeToLessType(this.jessNode.type);
        }
      },
      typeIndex: {
        enumerable: true,
        configurable: true,
        get: () => {
          const type = typeof this.lessType === 'function'
            ? this.lessType(this.jessNode)
            : (this.lessType ?? mapJessTypeToLessType(this.jessNode.type));
          return getLessTypeIndex(type);
        }
      },
      accept: {
        enumerable: false,
        configurable: true,
        value: (visitor: any) => {
          if (this.acceptImpl) {
            return this.acceptImpl(this.jessNode, visitor, this.cache);
          }
          return this.jessNode;
        }
      }
    });

    for (const [key, rawField] of Object.entries(definition.fields ?? {})) {
      const field = normalizeField(rawField);
      Object.defineProperty(this, key, {
        enumerable: field.enumerable ?? true,
        configurable: true,
        get: () => field.get(this.jessNode, this.cache),
        set: field.set
          ? (value: unknown) => field.set!(this.jessNode, value, this.cache)
          : undefined
      });
    }
  }
}

export function createLessAdapter<T extends Node>(
  jessNode: T,
  definition: LessAdapterDefinition<T>,
  cache?: WeakMap<Node, unknown>
): LessAdapterInstance<T> {
  const cached = cache?.get(jessNode);
  if (cached instanceof LessNodeAdapter) {
    return cached;
  }

  ACTIVE_ADAPTATIONS.add(jessNode);
  try {
    const adapter = new LessNodeAdapter(jessNode, definition, cache);
    cache?.set(jessNode, adapter);
    return adapter;
  } finally {
    ACTIVE_ADAPTATIONS.delete(jessNode);
  }
}

export function isAdaptingNode(node: Node): boolean {
  return ACTIVE_ADAPTATIONS.has(node);
}
