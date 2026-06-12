import {
  type TreeContext,
  type Context
} from '../context.js';
import type { TriviaMap } from '../types/index.js';
import { type Visitor } from '../visitor/index.js';
import { type Operator } from './util/calculate.js';
import type { Class, AbstractClass, Tagged } from 'type-fest';
import {
  type FinalPrintOptions,
  type PrintOptions,
  getPrintOptions,
  prepareRenderPrintState
} from './util/print.js';
import { consumeTrivia, emitTriviaTokens } from './util/trivia.js';
import { type MaybePromise, isThenable } from '@jesscss/awaitable-pipe';
import type { Rules } from './rules.js';
import type { Nil } from './nil.js';
import { nodeTypeBits } from './node-type.js';
import { isPlainObject } from './util/collections.js';
import {
  isRenderBuffer,
  prepareBufferPrintState,
  writePreparedRenderText,
  type RenderBuffer
} from './util/render-buffer.js';

const { isArray } = Array;

function emitTrivia(
  trivia: TriviaMap,
  lookup: 'before' | 'after',
  offset: number | undefined,
  options: PrintOptions
): void {
  emitTriviaTokens(consumeTrivia(trivia, offset, lookup, options), options);
}

type AllNodeOptions = {
  /**
   * This seems harder to implement. For now, for anything that needs
   * to be flattened, we hoist it to the root.
   */
  // hoistToParent?: boolean

  semi?: boolean;
};

/**
 * @todo - Clean up and delete these types and symbols, if not used.
 */
export type Primitive = undefined | boolean | string | number;
export type PrimitiveOrFunc = Primitive | ((...args: any[]) => any);

export const ABORT: unique symbol = Symbol('ABORT');
export const REMOVE: unique symbol = Symbol('REMOVE');
export const IS_PROXY: unique symbol = Symbol('IS_PROXY');
export type NodeVisitReturn = void | Node | symbol;
export type NodeOptions = Record<string, any> & AllNodeOptions;
export type RegistrationOptions = {
  reuseCanonical?: boolean;
};
export const DEFAULT_DATA = 'value';

type BasicNodeTypes = PrimitiveOrFunc | Node;
type NodeRecordValue = BasicNodeTypes | Array<BasicNodeTypes | PrimitiveOrFunc[]> | Record<string, any>;
export type NodeValueObject = Record<string, NodeRecordValue>;
export type NodeValue = BasicNodeTypes | BasicNodeTypes[] | NodeValueObject;

export type NodeSetKey<Data> =
  null | (Data extends readonly any[] ? number : Data extends object ? string & keyof Data : never);

export type NodeSetValue<Data, K> =
  K extends null ? Data
    : Data extends readonly any[] ? K extends number ? Data[number] : never
      : K extends keyof Data ? Data[K] : never;

export type NodeMapArray<
  T extends NodeValueObject = NodeValueObject,
  K = keyof T,
  V = T[string]
> = Array<[K, V]>;

export type LocationInfo = [
  startOffset: number,
  startLine: number,
  startColumn: number,
  endOffset: number,
  endLine: number,
  endColumn: number
];
export type NodeLocation = LocationInfo | [];

function createNodeOptions() {
  return Object.create(null);
}

function isPrimitiveValue(value: unknown): value is Primitive {
  return value === undefined
    || typeof value === 'boolean'
    || typeof value === 'string'
    || typeof value === 'number';
}

function mustBeNode(value: unknown): Node {
  if (value instanceof Node) {
    return value;
  }
  throw new TypeError('Expected node result.');
}

function setParent(node: Node, parent: Node | undefined): void {
  node.parent = parent;
}

function isRulesNode(node: Node | { type?: string } | undefined): node is Rules {
  return node?.type === 'Rules';
}

function sourceRootOf(node: Node): Rules | undefined {
  if (isRulesNode(node)) {
    return node;
  }
  if (node._sourceRoot) {
    return node._sourceRoot;
  }
  let current = node.parent;
  while (current) {
    if (isRulesNode(current)) {
      node._sourceRoot = current;
      return current;
    }
    if (current._sourceRoot) {
      node._sourceRoot = current._sourceRoot;
      return current._sourceRoot;
    }
    current = current.parent;
  }
  return undefined;
}

type MutableNodeValue = Record<string | number, unknown>;

function isMutableNodeValue(value: unknown): value is MutableNodeValue {
  return typeof value === 'object' && value !== null;
}

type TreeVisitMethod = (node: Node, ctx?: unknown) => NodeVisitReturn;
type VisitMethod = (node: Node) => Node;
type TypeVisitMethod = (node: Node) => NodeVisitReturn;

function getTreeVisitMethod(visitor: unknown): TreeVisitMethod | undefined {
  if (typeof visitor !== 'object' || visitor === null) {
    return undefined;
  }
  const method = (visitor as { _visit?: unknown })._visit;
  return typeof method === 'function' ? method : undefined;
}

function hasVisitedNodeSet(visitor: unknown): boolean {
  return typeof visitor === 'object'
    && visitor !== null
    && (visitor as { visitedNodes?: unknown }).visitedNodes instanceof Set;
}

function getVisitMethod(visitor: unknown): VisitMethod | undefined {
  if (typeof visitor !== 'object' || visitor === null) {
    return undefined;
  }
  const method = (visitor as { visit?: unknown }).visit;
  return typeof method === 'function' ? method : undefined;
}

function isStringKeyRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getTypeVisitMethod(visitor: unknown, methodName: string): TypeVisitMethod | undefined {
  if (!isStringKeyRecord(visitor)) {
    return undefined;
  }
  const method = visitor[methodName];
  return typeof method === 'function' ? method : undefined;
}

/**
 * Utility type to mark a node's value as generated
 */
export type GeneratedNodeValue<T> = T extends object ? T & { generated: true } : T;

export const defineType = <
  V = never,
  T extends AbstractClass<Node> = AbstractClass<Node>,
  P extends ConstructorParameters<T> = ConstructorParameters<T>
>(
  Clazz: T,
  type: string,
  shortType?: string
) => {
  shortType ??= type.toLowerCase();
  Clazz.prototype.type = type;
  Clazz.prototype.shortType = shortType;

  /** Build nodeType bitmask by OR-ing bits for each type in the prototype chain */
  let nodeType = 0;
  let ctor = Clazz;
  do {
    const proto = ctor?.prototype;
    const type = proto?.type;

    if (!type) {
      break;
    }

    const bit = nodeTypeBits[type];
    if (bit !== undefined) {
      nodeType |= bit;
    }

    ctor = Object.getPrototypeOf(ctor);
  } while (ctor);
  Clazz.prototype.nodeType = nodeType;

  type Args = [value?: P[0] | V, options?: P[1], location?: P[2]];
  return (...args: Args) => {
    const node: T extends Class<infer C> ? InstanceType<Class<C, Args>> : never = Reflect.construct(Clazz, args);
    return node;
  };
};

export type ConditionOperator = 'and' | 'or' | '=' | '>' | '<' | '>=' | '<=';

export type NoOverride<T> = Tagged<T, 'NoOverride'>;

// Node state flags as bitmask
export const F_VISIBLE = 0b1;
export const F_MAY_ASYNC = 0b10;
/**
 * @todo - The plan is to use these as signals for evaluation. If we
 * bubble these correctly, then we can exit early from evaluation for
 * a speed boost. However, bubbling is not yet water-tight and needs
 * test coverage.
 */
export const F_STATIC = 0b100;
export const F_NON_STATIC = 0b1000;
/** Whether or not a physical ampersand is in this selector */
export const F_AMPERSAND = 0b10000;
/** Whether an ampersand was implicitly added (not written by user) */
export const F_IMPLICIT_AMPERSAND = 0b100000;
/** Selector item produced by extend and eligible for reference-mode rendering. */
export const F_EXTENDED = 0b1000000;
/** Selector item that matches an extend target and should be suppressed in reference-mode output. */
export const F_EXTEND_TARGET = 0b10000000;
/** Node value owns at least one child node. */
export const F_HAS_NODE_CHILD = 0b100000000;

// Default state: only visible is true
export const F_DEFAULT = F_VISIBLE;

// Future flags can be added here
// export const CACHED = 0b1000000;
// export const DIRTY = 0b10000000;
// export const LOCKED = 0b100000000;

// const FULLY_EVALUATED = F_EVALUATED | F_PRE_EVALUATED;

export type Mutable<T extends { value: unknown }> =
  Omit<T, 'value'> & { -readonly [P in 'value']: T[P] };

export type EvalSyncResult<T extends Node> = Awaited<ReturnType<T['eval']>>;

/**
 * The underlying type for all Jess nodes
 */
export abstract class Node<
  Data = unknown,
  O extends NodeOptions = NodeOptions
> {
  _location: NodeLocation | undefined;
  get location() {
    return (this._location ??= []);
  }

  _sourceRoot: Rules | undefined;
  get sourceRoot(): Rules | undefined {
    return sourceRootOf(this);
  }

  _treeContext: TreeContext | undefined;

  protected _options: O & AllNodeOptions | undefined;
  get options(): O & AllNodeOptions {
    return (this._options ??= createNodeOptions());
  }

  set options(options: O & AllNodeOptions) {
    this._options = options;
  }

  /**
   * Assigned on the prototype, make sure we don't initialize
   */
  declare type: string;
  declare shortType: string;

  /**
   * Bitmask of this node's type and all ancestor types.
   * Set on the prototype by defineType. Used by isNode for O(1) type checking.
   * DO NOT initialize here — an `= 0` would create an own property that
   * shadows the prototype value set by defineType.
   */
  declare nodeType: number;

  /** Will be copied during inherit */
  state = F_DEFAULT;

  /** Runtime tracking: has this node completed registration identity prep? */
  registrationPrepared = false;

  /** Runtime tracking: has eval been run on this node? */
  evaluated = false;

  get visible() {
    return this.hasFlag(F_VISIBLE);
  }

  declare fullRender: boolean;

  /**
   * @todo - Move some to _meta?
   * Should do if some fields are not on the hot path
   * (not read very often)
   */
  allowRoot = false;
  allowRuleRoot = false;
  hoistToRoot: boolean | undefined = undefined;

  /**
   * Code internally should call .create() when making new
   * nodes, which will automatically mark the node as generated.
   */
  generated = false;

  /**
   * If the node must have a semi separator before
   * the next node when in a declaration list or main
   * rules list. Backed by `_requiredSemi`; exposed as a getter so
   * subclasses (e.g. Declaration) can override with computed logic.
   */
  declare _requiredSemi: boolean | undefined;
  get requiredSemi(): boolean | undefined {
    return this._requiredSemi;
  }

  set requiredSemi(value: boolean | undefined) {
    this._requiredSemi = value;
  }

  /**
   * Track the original source when cloned / copied,
   * rather than keeping the entire tree
   * Note: This property is defined in constructor as non-enumerable
   */
  declare sourceNode: Node;

  /**
   * When evaluating, nodes are assigned an index and depth by the Rules node.
   * This is used for lookup order. Note, this _will_ be undefined
   * initially, but we assign it in the Rules node, which is also
   * where we read it.
   */
  index: number | undefined;

  /** @todo - Is there a reliable way to cache this? */
  get depth() {
    let node = this.rulesParent;
    let depth = 0;
    while (node) {
      depth++;
      node = node.rulesParent;
    }
    return depth;
  }

  /**
   * If true, prevents re-parenting of this node.
   * This is used to maintain source lookup chains.
   */
  frozen = false;

  /**
   * The parent node of this node. Usually, this
   * shouldn't be set directly. Instead, a parent should use
   * parent.adopt(thisNode);
   */
  declare parent: Node | undefined;

  /** Patched at runtime in node.ts to return Nil instance */
  declare nil: () => Nil;

  /**
   * The node's data.
   *
   * This is `readonly` to prevent accidental unforked mutation.
   *
   * Mutation paths, in order of preference:
   *   1. `node.set(key, value)` — canonical mutation with parent adoption.
   *   2. Direct assignment with an explicit `@ts-expect-error` escape:
   *        // @ts-expect-error direct mutation: <why fork machinery is not needed here>
   *        node.value = newValue;
   *      Use this only when you know the caller is not bypassing parent
   *      adoption or other node invariants (parse time, in-place selector
   *      reshape helpers, etc.).
   *      Every bypass must carry its justification inline.
   *
   * Short-term exception: `util/extend.ts` and friends still do extensive
   * in-place selector reshaping and use the escape hatch liberally. That
   * subtree is on the list to migrate; new code outside it should prefer
   * option (1).
   */
  readonly value: Data;

  // /**
  //  * This is the internal `data` of the node.
  //  */
  // get value(): Data {
  //   return this._value;
  // }

  // set value(val: Data) {
  //   this._value = this._processNodes(val);
  //   // Invalidate memoized valueOf() on selector-like nodes after mutation.
  //   if ('_valueOf' in this) {
  //     (this as unknown as { _valueOf?: unknown })._valueOf = undefined;
  //   }
  // }

  /**
   * Add a flag to the node's state
   * Handles STATIC/NON_STATIC exclusivity automatically
   */
  addFlag(flag: number) {
    // NON_STATIC takes precedence over STATIC
    if (flag === F_STATIC && this.hasFlag(F_NON_STATIC)) {
      return;
    }
    this.state |= flag;
    // Handle STATIC/NON_STATIC exclusivity
    if (flag === F_NON_STATIC) {
      this.state &= ~F_STATIC;
    }
  }

  /**
   * Remove a flag from the node's state
   */
  removeFlag(flag: number) {
    this.state &= ~flag;
  }

  /**
   * Check if the node has a specific flag
   */
  hasFlag(flag: number): boolean {
    return (this.state & flag) !== 0;
  }

  /**
   * Add multiple flags to the node's state
   */
  addFlags(...flags: number[]) {
    for (const flag of flags) {
      this.addFlag(flag);
    }
  }

  adopt(node: Node) {
    /** The only place we should do this */
    if (!node.frozen) {
      setParent(node, this);
    }
    this.addFlag(F_HAS_NODE_CHILD);
    const sourceRoot = sourceRootOf(this);
    if (sourceRoot && !node._sourceRoot) {
      node._sourceRoot = sourceRoot;
    }
    if (node.hasFlag(F_NON_STATIC)) {
      this.addFlag(F_NON_STATIC);
      this.removeFlag(F_STATIC);
    } else if (node.hasFlag(F_STATIC)) {
      this.addFlag(F_STATIC);
    }
    if (node.hasFlag(F_MAY_ASYNC)) {
      this.addFlag(F_MAY_ASYNC);
    }
    if (node.hasFlag(F_AMPERSAND) && this.type !== 'Rules') {
      this.addFlag(F_AMPERSAND);
    }
  }

  /**
   * Assign parent to sub-nodes
   * @note - This will not process the children nodes of children nodes.
   */
  private _processNodes<T>(value: T): T {
    if (isArray(value)) {
      for (let val of value) {
        if (val instanceof Node) {
          this.adopt(val);
        }
      }
    } else if (isPlainObject(value)) {
      for (let k in value) {
        this._processNodes(value[k]);
      }
    } else {
      if (value instanceof Node) {
        this.adopt(value);
      }
    }

    return value;
  }

  constructor(
    value: Data,
    options?: O,
    location?: NodeLocation
  ) {
    // Make some props non-enumerable to avoid JSON serialization issues
    Object.defineProperties(this, {
      sourceNode: {
        value: this,
        writable: true,
        enumerable: false,
        configurable: false
      },
      parent: {
        value: undefined,
        writable: true,
        enumerable: false,
        configurable: false
      }
    });
    this.value = this._processNodes(value);
    this._location = location;
    this._options = options;
  }

  set<K extends NodeSetKey<Data>>(key: K, value: NodeSetValue<Data, K>): void;
  set(key: null | string | number, value: any) {
    if (key == null) {
      this.value = this._processNodes(value);
    } else {
      if (!isMutableNodeValue(this.value)) {
        throw new TypeError('Cannot set keyed value on a primitive node value.');
      }
      this.value[key] = this._processNodes(value);
    }
  }

  /**
   * Static factory method to create a generated node.
   * Has the exact same signature as the constructor but automatically marks the node as generated.
   *
   * @param value - The node's value data
   * @param options - Node options
   * @param location - Location information
   * @returns A new node instance with generated flag set if applicable
   */
  static create<T extends Node, V, NodeOptionsT extends NodeOptions>(
    this: new (value: V, options?: NodeOptionsT, location?: LocationInfo) => T,
    value: V,
    options?: NodeOptionsT,
    location?: LocationInfo
  ): T {
    // Create the instance with the same signature as constructor
    const instance = new this(value, options, location);

    // Mark as generated if the value is an object that can be marked
    if (instance instanceof Node) {
      instance.generated = true;
    }

    return instance;
  }

  get rulesParent(): Rules | undefined {
    let possibleRules: Node | undefined = this.parent;
    while (possibleRules && possibleRules.type !== 'Rules') {
      possibleRules = possibleRules.parent;
    }
    return isRulesNode(possibleRules) ? possibleRules : undefined;
  }

  get sourceRulesParent(): Rules | undefined {
    const directRulesParent = this.rulesParent;
    const frameFallbackNode = directRulesParent?.scopeFrame?.fallbackFrame?.rulesNode;
    if (isRulesNode(frameFallbackNode)) {
      return frameFallbackNode;
    }
    return undefined;
  }

  /**
   * Mutates node children in place. Used by eval()?
   *
   * Processed nodes must always return a Node.
   */
  private forEachNode(func: (n: Node, idx?: number) => MaybePromise<Node>, _context: Context) {
    if (!this.hasFlag(F_MAY_ASYNC)) {
      this._visitEntries((node, key, coll, idx) => {
        const result = mustBeNode(func(node, idx));
        coll[key] = result;
      });
      return;
    }

    let pending: Promise<void> | undefined;
    let resumeIndex = 0;
    let nodes: Node[] | undefined;
    let keys: Array<string | number> | undefined;
    let collections: any[] | undefined;

    this._visitEntries((node, key, coll, idx) => {
      if (pending) {
        (nodes ??= []).push(node);
        (keys ??= []).push(key);
        (collections ??= []).push(coll);
        return;
      }

      const out = func(node, idx);
      if (isThenable(out)) {
        resumeIndex = idx + 1;
        pending = out.then((result) => {
          coll[key] = mustBeNode(result);
        });
        return;
      }

      coll[key] = mustBeNode(out);
    });

    if (!pending) {
      return;
    }

    return pending.then(async () => {
      const resumeNodes = nodes;
      if (!resumeNodes) {
        return;
      }
      const resumeKeys = keys!;
      const resumeCollections = collections!;
      for (let i = 0; i < resumeNodes.length; i++) {
        const out = func(resumeNodes[i]!, resumeIndex + i);
        const result = isThenable(out) ? await out : out;
        resumeCollections[i]![resumeKeys[i]!] = mustBeNode(result);
      }
    });
  }

  /**
   * Iterate leaf values of this.value, calling `cb` for each.
   * Arrays → iterate elements; plain objects → iterate property values
   * (recursing into array property values); otherwise → the value itself.
   */
  private _visitValues(
    cb: (value: unknown) => void,
    reverse?: boolean
  ) {
    const data = this.value;
    if (isArray(data)) {
      if (reverse) {
        for (let i = data.length - 1; i >= 0; i--) {
          cb(data[i]);
        }
      } else {
        for (let i = 0; i < data.length; i++) {
          cb(data[i]);
        }
      }
    } else if (isPlainObject(data)) {
      for (const k in data) {
        const v = data[k];
        if (isArray(v)) {
          if (reverse) {
            for (let j = v.length - 1; j >= 0; j--) {
              cb(v[j]);
            }
          } else {
            for (let j = 0; j < v.length; j++) {
              cb(v[j]);
            }
          }
        } else {
          cb(v);
        }
      }
    } else {
      cb(data);
    }
  }

  /**
   * Visit each Node entry in this.value, calling `cb` for each.
   * Matches the iteration pattern of the old getEntriesFromNode:
   * arrays → iterate elements; plain objects → iterate properties
   * (recursing into array property values); otherwise → the value itself.
   */
  private _visitEntries(
    cb: (node: Node, key: string | number, collection: any, idx: number) => void
  ) {
    let idx = 0;
    const value = this.value;
    if (isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        if (value[i] instanceof Node) {
          cb(value[i], i, value, idx++);
        }
      }
    } else if (isPlainObject(value)) {
      for (const k in value) {
        const v = value[k];
        if (isArray(v)) {
          for (let i = 0; i < v.length; i++) {
            if (v[i] instanceof Node) {
              cb(v[i], i, v, idx++);
            }
          }
        } else if (v instanceof Node) {
          cb(v, k, value, idx++);
        }
      }
    } else if (value instanceof Node) {
      cb(value, 'value', this, idx);
    }
  }

  /**
   * Return an iterator for all nodes / children nodes, including this one
   */
  * nodes(reverse?: boolean): Generator<Node, void, unknown> {
    yield this;
    yield* this.children(true, reverse);
  }

  /**
  * An iterator for all node children
  * @todo - Replace `walkNodes` with this?
  */
  * children(deep?: boolean, reverse?: boolean): Generator<Node, void, unknown> {
    const value = this.value;
    if (isArray(value)) {
      if (reverse) {
        for (let i = value.length - 1; i >= 0; i--) {
          const nodeVal = value[i];
          if (nodeVal instanceof Node) {
            yield nodeVal;
            if (deep) {
              yield* nodeVal.children(deep, reverse);
            }
          }
        }
      } else {
        for (let i = 0; i < value.length; i++) {
          const nodeVal = value[i];
          if (nodeVal instanceof Node) {
            yield nodeVal;
            if (deep) {
              yield* nodeVal.children(deep, reverse);
            }
          }
        }
      }
      return;
    }
    if (isPlainObject(value)) {
      for (const k in value) {
        const childValue = value[k];
        if (isArray(childValue)) {
          if (reverse) {
            for (let i = childValue.length - 1; i >= 0; i--) {
              const nodeVal = childValue[i];
              if (nodeVal instanceof Node) {
                yield nodeVal;
                if (deep) {
                  yield* nodeVal.children(deep, reverse);
                }
              }
            }
          } else {
            for (let i = 0; i < childValue.length; i++) {
              const nodeVal = childValue[i];
              if (nodeVal instanceof Node) {
                yield nodeVal;
                if (deep) {
                  yield* nodeVal.children(deep, reverse);
                }
              }
            }
          }
        } else if (childValue instanceof Node) {
          yield childValue;
          if (deep) {
            yield* childValue.children(deep, reverse);
          }
        }
      }
      return;
    }
    if (value instanceof Node) {
      yield value;
      if (deep) {
        yield* value.children(deep, reverse);
      }
    }
  }

  /**
   * @todo - Remove?
   */
  // collectRoots(): Node[] {
  //   let list: Node[] = []
  //   this.walkNodes(n => {
  //     if (n.type === 'Rules') {
  //       const rules = n.rootRules
  //       if (rules) {
  //         for (let n of rules) {
  //           list.push(n)
  //         }
  //         n.rootRules = undefined
  //       }
  //     }
  //   })
  //   return list
  // }

  /**
   * Accept a visitor (classic visitor pattern).
   *
   * Visits the node itself first, then recursively visits children.
   * This matches the Less.js visitor pattern and allows nodes to control
   * their own traversal if needed by overriding this method.
   *
   * @param visitor - The visitor to accept
   * @returns The result from visiting this node (may be a replacement node)
   */
  accept(visitor: Visitor): Node {
    // Visit self first (like Less.js pattern).
    // Support both Visitor class instances (visit()) and plain visitor objects.
    let result: Node | NodeVisitReturn = this;
    const treeVisitMethod = getTreeVisitMethod(visitor);
    const visitMethod = getVisitMethod(visitor);
    if (treeVisitMethod && hasVisitedNodeSet(visitor)) {
      result = treeVisitMethod.call(visitor, this, {});
    } else if (visitMethod) {
      result = visitMethod.call(visitor, this);
    } else {
      const maybeAbort = visitor.enter?.(this);
      if (maybeAbort === ABORT) {
        return this;
      }
      const methodName = this.type.charAt(0).toLowerCase() + this.type.slice(1);
      const typeMethod = getTypeVisitMethod(visitor, methodName);
      if (typeMethod) {
        const visited = typeMethod.call(visitor, this);
        if (visited) {
          result = visited;
        }
      }
      result = visitor.exit?.(result) ?? result;
    }

    // Visit children recursively (Less.js pattern)
    // Note: If TreeVisitor is using accept(), it will skip auto-visiting children
    // to avoid double-visiting. See TreeVisitor._visit() implementation.
    for (const child of this.children()) {
      if (child.accept) {
        child.accept(visitor);
      } else {
        // Fallback: if child doesn't have accept, visit directly
        visitor.visit(child);
      }
    }

    // Return the result (may be a replacement node)
    return result instanceof Node ? result : this;
  }

  cloneValue(value: unknown): unknown {
    if (isArray(value)) {
      return [...value];
    } else if (isPlainObject(value)) {
      const clonedValue: Record<string, unknown> = {};
      for (const k in value) {
        clonedValue[k] = this.cloneValue(value[k]);
      }
      return clonedValue;
    }
    return value;
  }

  /**
   * Creates a copy of the current node.
   *
   * @note - In the Less source, nodes were always cloned before
   * mutating, which is why I did it here. However... the only
   * utility for cloning is to preserve the original node,
   * or (maybe?) to create a copy which is output differently.
   *
   * But... considering the high cost of cloning in terms of
   * object creation, and the low utility of preserving the original
   * node, I think we should just only clone when we need to.
   */
  clone(deep?: boolean, cloneFn?: (n: Node) => Node): this {
    let cloned = this.cloneValue(this.value);

    if (deep) {
      cloneFn ??= n => n.clone(deep);
      if (cloned instanceof Node) {
        cloned = cloneFn(cloned);
      } else {
        this._deepCloneChildren(cloned, cloneFn);
      }
    }

    const newNode: this = Reflect.construct(
      this.constructor,
      [cloned, this._options ? { ...this._options } : undefined, this.location]
    );
    newNode.inherit(this);

    return newNode;
  }

  private _deepCloneChildren(value: unknown, cloneFn: (n: Node) => Node) {
    if (isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        const item = value[i];
        if (item instanceof Node) {
          value[i] = cloneFn(item);
        } else if (isArray(item)) {
          this._deepCloneChildren(item, cloneFn);
        }
      }
    } else if (isPlainObject(value)) {
      for (const k in value) {
        const v = value[k];
        if (v instanceof Node) {
          value[k] = cloneFn(v);
        } else if (isArray(v)) {
          this._deepCloneChildren(v, cloneFn);
        }
      }
    }
  }

  /** Minimal nil fallback for edge cases where prototype method isn't attached yet */
  private _createMinimalNil(): Node {
    // @ts-expect-error - normally an abstract class
    const nilish = new Node();
    nilish.type = 'Nil';
    nilish.shortType = 'nil';
    nilish.nodeType = nodeTypeBits['Nil']!;
    nilish.removeFlag(F_VISIBLE);
    nilish.value = '';
    return nilish;
  }

  /**
   * Same as clone except comments are stripped.
   * This is used for variable referencing and
   * selector extending.
   */
  copy(deep?: boolean, cloneFn?: (n: Node) => Node): this {
    const newNode = this.clone(
      deep,
      (n) => {
        if (n.type !== 'Comment') {
          const copy = n.copy(deep, cloneFn);
          return copy;
        }
        const nilNode = this.nil?.() || this._createMinimalNil();
        return nilNode.inherit(n);
      }
    );
    if (this.hasFlag(F_AMPERSAND)) {
      newNode.addFlag(F_AMPERSAND);
    }
    if (this.hasFlag(F_IMPLICIT_AMPERSAND)) {
      newNode.addFlag(F_IMPLICIT_AMPERSAND);
    }
    return newNode;
  }

  /**
   * Stop this node from reading file-owned trivia during serialization.
   *
   * Use this for copied values that are rendered in a new evaluated placement,
   * such as function return values or mixin argument bindings. The source node
   * still exists as `sourceNode`; this clears the copied source offsets/context
   * so whitespace/comments from the original file boundary are not consumed in
   * the new output position.
   */
  detachTrivia(deep?: boolean): this {
    this._sourceRoot = undefined;
    if (isRulesNode(this)) {
      this._treeContext = undefined;
    }
    this._location = undefined;
    if (deep) {
      this._detachChildTrivia(this.value);
    }
    return this;
  }

  private _detachChildTrivia(value: unknown): void {
    if (isArray(value)) {
      for (const item of value) {
        if (item instanceof Node) {
          item.detachTrivia(true);
        } else {
          this._detachChildTrivia(item);
        }
      }
    } else if (isPlainObject(value)) {
      for (const k in value) {
        this._detachChildTrivia(value[k]);
      }
    } else if (value instanceof Node) {
      value.detachTrivia(true);
    }
  }

  /**
   * Registration-time identity preparation.
   *
   * The default recursively prepares children for registration. Nodes with
   * narrower identity or mark-only behavior override this method directly.
   */
  prepareRegistration(context: Context, _options?: RegistrationOptions): MaybePromise<Node> {
    if (!this.registrationPrepared) {
      const node = this;
      node.registrationPrepared = true;

      // Note: Rules nodes handle index assignment for themselves and their children
      // Other nodes will get indices assigned by their parent Rules
      const out = node.forEachNode(n => n.prepareRegistration(context), context);
      if (isThenable(out)) {
        return (out as Promise<void>).then(() => node);
      }
      return node;
    }
    return this;
  }

  /**
   * This is the method all nodes will override.
   * Individual nodes will specify / narrow return type
   *
   * By default, evals all children
   */
  protected evalNode(context: Context): MaybePromise<Node> {
    if (this.hasFlag(F_STATIC)) {
      return this;
    }
    let out = this.forEachNode((n: Node) => {
      return n.eval(context);
    }, context);
    if (isThenable(out)) {
      return (out as Promise<void>).then(() => {
        return this;
      });
    }
    return this;
  }

  static evalStatic(node: Node, context: Context): MaybePromise<Node> {
    if (node.hasFlag(F_STATIC) && node.evaluated) {
      return node;
    }

    /**
     * Canonical nodes are always eligible for re-evaluation — they're the
     * template, not a retained result. The remaining fork storage no longer
     * tracks an "active render key" on the node itself.
     */
    // Frozen non-static nodes are reusable placement templates; their eval
    // result is context-dependent and must not be retained across placements.
    const needsReeval = node.frozen && !node.hasFlag(F_STATIC);

    if (!node.hasFlag(F_MAY_ASYNC)) {
      return Node._evalStaticSync(node, context, needsReeval);
    }

    const evaluated = node.evaluated && !needsReeval
      ? node
      : node.evalNode(context);
    if (isThenable(evaluated)) {
      return (evaluated as Promise<Node>).then((evald) => {
        evald.evaluated = true;
        if (node !== evald) {
          evald.inherit(node);
        }
        return evald;
      });
    }
    evaluated.evaluated = true;
    if (node !== evaluated) {
      evaluated.inherit(node);
    }
    return evaluated;
  }

  private static _evalStaticSync(node: Node, context: Context, needsReeval = false): Node {
    let evald: Node;
    if (!node.evaluated || needsReeval) {
      evald = mustBeNode(node.evalNode(context));
    } else {
      evald = node;
    }
    evald.evaluated = true;
    if (node !== evald) {
      evald.inherit(node);
    }
    return evald;
  }

  /**
   * @note - Make sure you don't call super.eval while evaluating a node. Call it indirectly
   * from another node.
   */
  eval(context: Context): MaybePromise<Node> {
    return Node.evalStatic(this, context);
  }

  evalSync<T extends this>(this: T, context: Context): EvalSyncResult<T>;
  evalSync(context: Context): Node {
    if (!this.hasFlag(F_MAY_ASYNC)) {
      return this.eval === Node.prototype.eval
        ? Node._evalStaticSync(this, context)
        : mustBeNode(this.eval(context));
    }
    const evaluated = this.eval(context);
    if (isThenable(evaluated)) {
      throw new TypeError('Expected synchronous eval result.');
    }
    return evaluated;
  }

  /**
   * Value-returning sibling of `render(context)`.
   *
   * This resolves the node in context without writing to the print buffer.
   * Callers should use the returned node immediately rather than treating it
   * as a retained second tree.
   */
  resolve(context: Context): MaybePromise<Node> {
    return this.eval(context);
  }

  /**
   * This is used when a Node will replace another node.
   */
  inherit(node: Node) {
    /**
     * Frozen nodes inherit the parent only if they don't have a parent yet.
     */
    if (!this.frozen) {
      setParent(this, node.parent);
    } else {
      setParent(this, this.parent ?? node.parent);
    }
    this._location = node.location;
    this._sourceRoot ??= node.sourceRoot;
    if (isRulesNode(this)) {
      this._treeContext ??= node.sourceRoot?._treeContext;
    }
    /** Copy state exactly (not OR, to preserve removed flags) */
    // Only sync F_VISIBLE flag, preserve all other flags
    if (!node.hasFlag(F_VISIBLE)) {
      this.removeFlag(F_VISIBLE);
    }
    // Preserve F_IMPLICIT_AMPERSAND so cloned selectors (e.g. after extend) keep invisible-ampersand
    // handling in createProcessedSelector and valueOf() remains correct for exact extend matching.
    if (node.hasFlag(F_IMPLICIT_AMPERSAND)) {
      this.addFlag(F_IMPLICIT_AMPERSAND);
    }
    if (node.hasFlag(F_EXTENDED)) {
      this.addFlag(F_EXTENDED);
    }
    if (node.hasFlag(F_EXTEND_TARGET)) {
      this.addFlag(F_EXTEND_TARGET);
    }
    // Preserve the generated flag when inheriting; never overwrite true with false
    // (e.g. Ampersand.eval returns PseudoSelector with .generated true, then evalStatic
    // calls PseudoSelector.inherit(Ampersand), which would otherwise overwrite with false)
    this.generated = this.generated || node.generated;
    /**
     * If it's replacing a node that's evaluated, it should inherit the same index.
     * Otherwise, it should be settable after cloning / copying.
     */
    this.index ??= node.index;
    return this;
  }

  /**
   * Represents the normalized string value of the node,
   * for the purposes of comparison with other nodes,
   * regardless of type.
   *
   * Derived nodes will override this with different
   * normalization algorithms.
   */
  valueOf(): Primitive {
    let value = this.value;
    if (isPrimitiveValue(value)) {
      return value;
    }
    let result = '';
    let count = 0;
    let first: unknown;
    this._visitValues((v) => {
      if (count === 0) {
        first = v;
      }
      count++;
      result += `${v}`;
    });
    if (count === 1) {
      return `${first}`;
    }
    return result;
  }

  /**
   * Re-serializes the node in its authored form.
   *
   * This is the canonical source serializer, not the evaluated render path.
   * It includes outer trivia so the shared AST can
   * still round-trip back to Jess/Less-like source.
   *
   * In almost all Node cases, this should not be overridden, and
   * `toTrimmedString()` should be overridden instead.
   */
  toString(options?: PrintOptions): string {
    if (!this.hasFlag(F_VISIBLE) && !this.fullRender) {
      return '';
    }
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    const trivia = options.trivia
      ?? this.sourceRoot?._treeContext?.opts?.trivia;
    if (trivia && options.trivia !== trivia) {
      options.trivia = trivia;
    }
    const suppressPre = options.suppressBoundaryTrivia === 'pre'
      || options.suppressBoundaryTrivia === 'both';
    if (!suppressPre && trivia) {
      emitTrivia(trivia, 'before', this.location[0], options);
    }
    this.toTrimmedString(options);
    return w.getSince(mark);
  }

  /**
   * Renders this node's direct syntax through the context-owned print state.
   *
   * The base implementation is only the inherited static/source serializer. It
   * must not resolve/evaluate the node first. Nodes whose output depends on
   * context override this method and serialize their evaluated output
   * through the same print-state machinery.
   */
  render(context: Context, buffer: RenderBuffer, options?: PrintOptions): string;
  render(context: Context, options?: PrintOptions): string;
  render(context: Context, bufferOrOptions?: RenderBuffer | PrintOptions, options?: PrintOptions): string {
    if (!this.hasFlag(F_VISIBLE) && !this.fullRender) {
      return '';
    }
    return this.renderSource(context, bufferOrOptions, options);
  }

  protected renderSource(
    context: Context,
    bufferOrOptions?: RenderBuffer | PrintOptions,
    options?: PrintOptions
  ): string {
    const buffer = isRenderBuffer(bufferOrOptions) ? bufferOrOptions : undefined;
    const printOptions = isRenderBuffer(bufferOrOptions) ? undefined : bufferOrOptions;
    const prepared = buffer
      ? prepareBufferPrintState(context, options, buffer)
      : prepareRenderPrintState(context, printOptions);
    const mark = buffer ? prepared.writer.mark() : 0;
    const out = this.toTrimmedString(prepared);
    return buffer
      ? writePreparedRenderText(buffer, prepared, mark, out)
      : out;
  }

  protected renderOutput(
    context: Context,
    node: Node,
    bufferOrOptions?: RenderBuffer | PrintOptions,
    options?: PrintOptions
  ): MaybePromise<string> {
    if (node === this) {
      return this.renderSource(context, bufferOrOptions, options);
    }
    return isRenderBuffer(bufferOrOptions)
      ? node.render(context, bufferOrOptions, options)
      : node.render(context, bufferOrOptions);
  }

  /**
   * The authored body form of the node without outer comments and
   * whitespace.
   *
   * @note - Internally, this still calls `toString()` on each value,
   * so that the internal spacing of the node serialization is
   * correct. This method just serializes a node without the outer
   * whitespace, and does not require a render context.
   */
  toTrimmedString(options?: PrintOptions) {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    this._visitValues((v) => {
      if (v instanceof Node) {
        v.toString(options);
      } else {
        const s = v === undefined ? '' : String(v);
        if (s) {
          w.add(s, this);
        }
      }
    }, false);
    return w.getSince(mark);
  }

  writeSyntax(options: FinalPrintOptions): void {
    this._visitValues((v) => {
      if (v instanceof Node) {
        v.toString(options);
      } else {
        const s = v === undefined ? '' : String(v);
        if (s) {
          options.writer.add(s, this);
        }
      }
    }, false);
  }

  /**
   * Individual node types will override this.
   *
   * This is just a default implementation.
   * 0 = equal (==)
   * 1 = greater than (>)
   * -1 = less than (<)
   * undefined = not comparable
   */
  compare(b: Node, _context?: Context): 0 | 1 | -1 | undefined {
    let aVal = this.valueOf();
    let bVal = b.valueOf();
    if (aVal === bVal) {
      return 0;
    }
    if (aVal === undefined || bVal === undefined) {
      return undefined;
    }
    return aVal > bVal ? 1 : -1;
  }

  /** Overridden in index.ts to avoid circularity */
  operate(_b: Node, _op: Operator, _context: Context): Node {
    return this;
  }

  static numericCompare(a: number, b: number) {
    if (a === b) {
      return 0;
    } else if (Math.abs(a - b) < Number.EPSILON) {
      /** Close enough! Prevents floating point precision issues */
      return 0;
    } else if (a > b) {
      return 1;
    } else {
      return -1;
    }
  }

  /**
   * Generates a .js module
   * @todo - Generate a .ts module & .js.map
   */
  /** Move to ToModuleVisitor */
  // toModule?(context: Context, out: OutputCollector): void
}

/** When converting Less/Sass to Jess, we'll switch this flag temporarily */
Node.prototype.fullRender = false;
