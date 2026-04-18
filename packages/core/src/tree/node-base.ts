import {
  type TreeContext,
  type Context
} from '../context.js';
import type { IToken } from 'chevrotain';
import type { TriviaMap } from '../types/index.js';
import { type Visitor } from '../visitor/index.js';
import { type Operator } from './util/calculate.js';
import type { Class, AbstractClass, Tagged } from 'type-fest';
import type { Comment } from './comment.js';
import {
  type BoundaryIntentOptions,
  type PrintOptions,
  getPrintOptions,
  prepareContextPrintState
} from './util/print.js';
import { type MaybePromise, pipe, isThenable, serialForEach } from '@jesscss/awaitable-pipe';
import type { Rules } from './rules.js';
import type { Nil } from './nil.js';
import { nodeTypeBits } from './node-type.js';
import { isPlainObject } from './util/collections.js';
export type { TreeContext };

const { isArray } = Array;

function emitTrivia(
  map: Map<number, IToken[]>,
  offset: number | undefined,
  options: PrintOptions
): void {
  if (offset === undefined) {
    return;
  }
  const tokens = map.get(offset);
  if (!tokens) {
    return;
  }
  const emittedTrivia = options.emittedTrivia ?? (options.emittedTrivia = new Set());
  if (emittedTrivia.has(tokens)) {
    return;
  }
  emittedTrivia.add(tokens);
  const writer = options.writer!;
  for (const token of tokens) {
    writer.add(token.image);
  }
}

type AllNodeOptions = {
  /**
   * This seems harder to implement. For now, for anything that needs
   * to be flattened, we hoist it to the root.
   */
  // hoistToParent?: boolean

  /**
   * For statements with optional semis,
   * we flag this for accurate re-serialization.
   *
   * @todo - Not sure if we actually need this, but it's here
   * if we wanted a concrete syntax tree.
   */
  semi?: boolean;
  preIntent?: BoundaryIntentOptions['preIntent'];
  postIntent?: BoundaryIntentOptions['postIntent'];
};

/**
 * @todo - Clean up and delete these types and symbols, if not used.
 */
export type Primitive = undefined | boolean | string | number;
export type PrimitiveOrFunc = Primitive | ((...args: any[]) => any);

const primitives = ['undefined', 'boolean', 'string', 'number'];

export const ABORT: unique symbol = Symbol('ABORT');
export const REMOVE: unique symbol = Symbol('REMOVE');
export const IS_PROXY: unique symbol = Symbol('IS_PROXY');
export type NodeVisitReturn = void | Node | symbol;
export type NodeOptions = Record<string, any> & AllNodeOptions;
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
    const type = proto && Object.hasOwn(proto, 'type')
      ? proto.type
      : undefined;

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
    const node = new (Clazz as any)(...args) as T extends Class<infer C> ? InstanceType<Class<C, Args>> : never;
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

// Default state: only visible is true
export const F_DEFAULT = F_VISIBLE;

// Future flags can be added here
// export const CACHED = 0b1000000;
// export const DIRTY = 0b10000000;
// export const LOCKED = 0b100000000;

// const FULLY_EVALUATED = F_EVALUATED | F_PRE_EVALUATED;

export type Mutable<T extends { value: unknown }> =
  Omit<T, 'value'> & { -readonly [P in 'value']: T[P] };

/**
 * The underlying type for all Jess nodes
 */
export abstract class Node<
  Data = unknown,
  O extends NodeOptions = NodeOptions
> {
  _location: LocationInfo | [] | undefined;
  get location() {
    return (this._location ??= []);
  }

  private _treeContext: TreeContext | undefined;
  /** Assigned in index to avoid circularity */
  declare readonly treeContext: TreeContext;

  protected _options: O & AllNodeOptions | undefined;
  get options(): O & AllNodeOptions {
    return (this._options ??= {} as O & AllNodeOptions);
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

  /**
   * Whitespace or comments before or after a Node.
   *
   * If this is `1`, it represents a single space character (' ').
   * If it's 0, it means there were no pre/post tokens when parsed.
   * If undefined, it means this was created using the API, and default
   * formatting can be used.
   * In a NodeList, any whitespace tokens outside of comments are individually represented,
   * because they are preserved while the comment may not be.
   */
  /** Nil type is resolved at runtime via prototype patching */
  pre: Array<Comment | Node | string> | 1 | 0 | undefined;
  post: Array<Comment | Node | string> | 1 | 0 | undefined;

  /** Will be copied during inherit */
  state = F_DEFAULT;

  /** Runtime tracking: has preEval been run on this node? */
  preEvaluated = false;
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
   * where we read it, so this makes the type easier.
   */
  index!: number;

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
  declare readonly parent: Node | undefined;

  getParent() {
    return this.parent;
  }

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
  //   this._value = this._tryProxyWrap(val);
  //   // Invalidate memoized valueOf() on selector-like nodes after mutation.
  //   if ('_valueOf' in this) {
  //     (this as unknown as { _valueOf?: unknown })._valueOf = undefined;
  //   }
  // }

  /**
   * This wraps the value in a proxy if it's an object or array.
   * We do this so that assignment to the sub-nodes will properly
   * set the parent of the sub-nodes.
   *
   * @todo - Test parent setting for objects / arrays.
   */
  private _tryProxyWrap<T>(value: T): T {
    if (isPlainObject(value) || isArray(value)) {
      value = this._processNodes(value);
      return new Proxy(value as object, {
        get: (target, prop) => {
          if (prop === IS_PROXY) {
            return true;
          }
          const returnVal = Reflect.get(target, prop);
          if (isPlainObject(returnVal) || isArray(returnVal)) {
            if (Reflect.get(returnVal as object, IS_PROXY)) {
              /** Already a proxy so don't re-wrap it */
              return returnVal;
            }
            return this._tryProxyWrap(returnVal);
          }
          return returnVal;
        },
        set: (target, prop, newValue) => {
          if (isPlainObject(newValue) || isArray(newValue)) {
            newValue = this._processNodes(newValue);
          }
          if (newValue instanceof Node) {
            this.adopt(newValue);
          }
          return Reflect.set(target, prop, newValue);
        }
      }) as T;
    }

    return this._processNodes(value);
  }

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
      (node as any).parent = this;
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
    location?: LocationInfo,
    treeContext?: TreeContext
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
    this.value = this._processNodes(value); // this._tryProxyWrap(value);
    this._treeContext = treeContext;
    this._location = location;
    this._options = options;
  }

  getValue() {
    return this.value;
  }

  set<K extends NodeSetKey<Data>>(key: K, value: NodeSetValue<Data, K>): void;
  set(key: null | string | number, value: any) {
    if (key == null) {
      (this as Mutable<Node>).value = this._processNodes(value);
    } else {
      (this.value as Record<string | number, any>)[key] = this._processNodes(value);
    }
  }

  /**
   * Static factory method to create a generated node.
   * Has the exact same signature as the constructor but automatically marks the node as generated.
   *
   * @param value - The node's value data
   * @param options - Node options
   * @param location - Location information
   * @param treeContext - Tree context
   * @returns A new node instance with generated flag set if applicable
   */
  static create<T extends new (...args: any[]) => Node>(
    this: T,
    value: ConstructorParameters<T>[0],
    options?: ConstructorParameters<T>[1],
    location?: ConstructorParameters<T>[2],
    treeContext?: ConstructorParameters<T>[3]
  ): InstanceType<T> {
    // Create the instance with the same signature as constructor
    const instance = new this(value, options, location, treeContext) as InstanceType<T>;

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
    return possibleRules as Rules;
  }

  get sourceRulesParent(): Rules | undefined {
    const directRulesParent = this.rulesParent as Rules | undefined;
    const frameFallbackNode = directRulesParent?.scopeFrame?.fallbackFrame?.rulesNode as
      | { type?: string }
      | undefined;
    if (frameFallbackNode?.type === 'Rules') {
      return frameFallbackNode as Rules;
    }
    return undefined;
  }

  /**
   * Mutates node children in place. Used by eval()?
   *
   * Processed nodes must always return a Node.
   */
  private forEachNode(func: (n: Node, idx?: number) => MaybePromise<Node>, context: Context) {
    if (!this.hasFlag(F_MAY_ASYNC)) {
      this._visitEntries((node, key, coll, idx) => {
        const result = func(node, idx) as Node;
        coll[key] = result;
      });
      return;
    }
    const entries: [Node, string | number, any][] = [];
    this._visitEntries((node, key, coll) => {
      entries.push([node, key, coll]);
    });
    return serialForEach(entries, ([value, key, collection]: [Node, string | number, any], idx: number) => {
      const out = func(value, idx);
      if (isThenable(out)) {
        return (out as Promise<Node>).then((result) => {
          collection[key] = result;
        });
      }
      const result = out as Node;
      collection[key] = result;
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
      const values = Object.values(data as Record<string, unknown>);
      for (let i = 0; i < values.length; i++) {
        const v = values[i];
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
          cb(value[i] as Node, i, value, idx++);
        }
      }
    } else if (isPlainObject(value)) {
      const obj = value as Record<string, unknown>;
      for (const k in obj) {
        if (!Object.hasOwn(obj, k)) {
          continue;
        }
        const v = obj[k];
        if (isArray(v)) {
          for (let i = 0; i < v.length; i++) {
            if (v[i] instanceof Node) {
              cb(v[i] as Node, i, v, idx++);
            }
          }
        } else if (v instanceof Node) {
          cb(v, k, obj, idx++);
        }
      }
    } else if (value instanceof Node) {
      cb(value, 'value', this, idx);
    }
  }

  static* nodeAndPrePost(node: Node) {
    if (isArray(node.pre)) {
      for (let n of node.pre) {
        if (n instanceof Node) {
          yield n;
        }
      }
    }
    yield node;
    if (isArray(node.post)) {
      for (let n of node.post) {
        if (n instanceof Node) {
          yield n;
        }
      }
    }
  }

  /**
   * Return an iterator for all nodes / children nodes, including this one
   */
  * nodes(reverse?: boolean, includePrePost?: boolean): Generator<Node, void, unknown> {
    if (includePrePost) {
      yield* Node.nodeAndPrePost(this);
    } else {
      yield this;
    }
    yield* this.children(true, reverse, includePrePost);
  }

  /**
   * An iterator for all node children
   * @todo - Replace `walkNodes` with this?
   */
  * children(deep?: boolean, reverse?: boolean, includePrePost?: boolean): Generator<Node, void, unknown> {
    const nodes: Node[] = [];
    this._visitValues((v) => {
      if (v instanceof Node) {
        nodes.push(v);
      }
    }, reverse);
    for (const nodeVal of nodes) {
      if (includePrePost) {
        yield* Node.nodeAndPrePost(nodeVal);
      } else {
        yield nodeVal;
      }
      if (deep) {
        yield* nodeVal.children(deep, reverse, includePrePost);
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
    const treeVisitMethod = (visitor as unknown as { _visit?: (node: Node, ctx?: unknown) => NodeVisitReturn })._visit;
    const hasTreeVisitorState = (visitor as unknown as { visitedNodes?: unknown }).visitedNodes instanceof Set;
    const visitMethod = (visitor as unknown as { visit?: (node: Node) => Node }).visit;
    if (typeof treeVisitMethod === 'function' && hasTreeVisitorState) {
      result = treeVisitMethod.call(visitor, this, {});
    } else if (typeof visitMethod === 'function') {
      result = visitMethod.call(visitor, this);
    } else {
      const maybeAbort = visitor.enter?.(this);
      if (maybeAbort === ABORT) {
        return this;
      }
      const methodName = this.type.charAt(0).toLowerCase() + this.type.slice(1);
      const typeMethod = (visitor as unknown as Record<string, unknown>)[methodName];
      if (typeof typeMethod === 'function') {
        const visited = (typeMethod as (node: Node) => NodeVisitReturn).call(visitor, this);
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

  cloneValue<V extends NodeValue | Data>(value: V): V {
    if (isArray(value)) {
      return [...value] as V;
    } else if (isPlainObject(value)) {
      const clonedValue: Record<string, unknown> = {};
      for (const k in value) {
        if (Object.hasOwn(value, k)) {
          clonedValue[k] = this.cloneValue(value[k] as NodeValue);
        }
      }
      return clonedValue as V;
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
    let Class = this.constructor as Class<this>;
    let cloned = this.cloneValue(this.value);

    if (deep) {
      cloneFn ??= n => n.clone(deep);
      if (cloned instanceof Node) {
        cloned = cloneFn(cloned) as Data;
      } else {
        this._deepCloneChildren(cloned, cloneFn);
      }
    }

    let newNode = new Class(cloned, this._options ? { ...this._options } : undefined, this.location, this.treeContext);
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
      const obj = value as Record<string, unknown>;
      for (const k in obj) {
        if (!Object.hasOwn(obj, k)) {
          continue;
        }
        const v = obj[k];
        if (v instanceof Node) {
          obj[k] = cloneFn(v);
        } else if (isArray(v)) {
          this._deepCloneChildren(v, cloneFn);
        }
      }
    }
  }

  /** Remove comments from pre/post */
  stripPrePost(n: Node, preOrPost: 'pre' | 'post') {
    const prePost = n[preOrPost];
    if (isArray(prePost)) {
      const clonedPrePost = [...prePost];
      n[preOrPost] = clonedPrePost;
      for (let [key, node] of clonedPrePost.entries()) {
        if (node instanceof Node && node.type === 'Comment') {
          /** Replace comment with a nil node that inherits location */
          const nilNode = this.nil?.() || this._createMinimalNil();
          clonedPrePost[key] = nilNode.inherit(node);
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
    // Strip comments from pre/post, preserving whitespace
    newNode.stripPrePost(newNode, 'pre');
    newNode.stripPrePost(newNode, 'post');
    return newNode;
  }

  /**
   * `preEval` takes the following steps, which are extended in subclasses:
   * 1. Clone the node (if the source node is wanted/needed)
   * 2. Set `preEvaluated` to true
   * 3. pre-evaluate all children
   * 4. Return the node
   *
   * Mostly this is overridden to resolve names before registering.
   *
   * @todo - Update preEval / eval to use static evaluation based on flags.
  */
  preEval(context: Context): MaybePromise<Node> {
    if (!this.preEvaluated) {
      const node = this;
      node.preEvaluated = true;

      // Note: Rules nodes handle index assignment for themselves and their children
      // Other nodes will get indices assigned by their parent Rules
      let out: MaybePromise<void>;
      try {
        out = node.forEachNode(n => n.preEval(context), context);
      } catch (error: unknown) {
        throw error;
      }
      if (isThenable(out)) {
        return (out as Promise<void>).then(() => node).catch((error: unknown) => {
          throw error;
        });
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
    const needsReeval = false;

    if (!node.hasFlag(F_MAY_ASYNC)) {
      return Node._evalStaticSync(node, context, needsReeval);
    }

    let preEvaluatedNode: Node;

    return pipe(
      () => {
        if (!node.preEvaluated || needsReeval) {
          return node.preEval(context);
        }
        return node;
      },
      (preEvald) => {
        preEvaluatedNode = preEvald;
        preEvaluatedNode.preEvaluated = true;
        if (preEvald !== node) {
          preEvaluatedNode.inherit(node);
        }
        if (!preEvaluatedNode.evaluated || needsReeval) {
          return preEvaluatedNode.evalNode(context);
        }
        return preEvaluatedNode;
      },
      (evald) => {
        evald.evaluated = true;
        if (preEvaluatedNode !== evald) {
          evald.inherit(preEvaluatedNode);
        }
        return evald;
      }
    );
  }

  private static _evalStaticSync(node: Node, context: Context, needsReeval = false): Node {
    let preEvaluatedNode: Node;

    if (!node.preEvaluated || needsReeval) {
      preEvaluatedNode = node.preEval(context) as Node;
    } else {
      preEvaluatedNode = node;
    }
    preEvaluatedNode.preEvaluated = true;
    if (preEvaluatedNode !== node) {
      preEvaluatedNode.inherit(node);
    }

    let evald: Node;
    if (!preEvaluatedNode.evaluated || needsReeval) {
      evald = preEvaluatedNode.evalNode(context) as Node;
    } else {
      evald = preEvaluatedNode;
    }
    evald.evaluated = true;
    if (preEvaluatedNode !== evald && typeof evald.inherit === 'function') {
      evald.inherit(preEvaluatedNode);
    }
    return evald;
  }

  /**
   * @note - Make sure you don't call super.eval while evaluating a node. Call it indirectly
   * from another node.
   */
  eval(context: Context): MaybePromise<Node> {
    if (Object.getPrototypeOf(this).eval !== Node.prototype.eval) {
      throw new Error('Do not call super.eval() from a subclass.');
    }
    return Node.evalStatic(this, context);
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
      (this as any).parent = node.parent;
    } else {
      (this as any).parent ??= node.parent;
    }
    this._location = node.location;
    this._treeContext ??= node.treeContext;
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
    // Note that we need to create new arrays if we mutate pre/post later
    this.pre ||= node.pre;
    this.post ||= node.post;
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
    let type = typeof value;
    if (primitives.includes(type)) {
      return value as Primitive;
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

  processPrePost(key: 'pre' | 'post', defaultVal: string = '', options: PrintOptions) {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    let value = this[key];
    if (value === undefined) {
      if (defaultVal) {
        w.add(defaultVal);
        if (defaultVal === ' ') {
          w.signalBoundaryIntent(key, 'explicit_space');
        }
      }
      return w.getSince(mark);
    } else if (value === 0) {
      w.signalBoundaryIntent(key, 'explicit_none');
      return '';
    } else if (value === 1) {
      w.add(' ');
      w.signalBoundaryIntent(key, 'explicit_space');
      return w.getSince(mark);
    } else if (isArray(value)) {
      // Handle Node[] array - call toString() on each node (they will emit into writer)
      for (let node of value) {
        if (node instanceof Node) {
          node.toString(options);
        } else {
          const s = String(node);
          w.add(s);
        }
      }
      return w.getSince(mark);
    } else {
      const s = String(value);
      w.add(s);
      return w.getSince(mark);
    }
  }

  /**
   * Re-serializes the node in its authored form.
   *
   * This is the canonical source serializer, not the evaluated render path.
   * It includes outer pre/post whitespace and comments so the shared AST can
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
    const trivia = options.context
      ? undefined
      : (options.trivia
          ?? this.treeContext?.opts?.trivia) as TriviaMap | undefined;
    if (trivia && options.trivia !== trivia) {
      options.trivia = trivia;
    }
    const intentPre = this._options?.preIntent;
    const intentPost = this._options?.postIntent;
    const pre = this.pre !== undefined
      ? w.capture(() => this.processPrePost('pre', '', options))
      : (intentPre === undefined && trivia
          ? w.capture(() => emitTrivia(trivia.before, this.location[0], options))
          : '');
    const preIntent = this.pre === 0
      ? 'explicit_none'
      : (this.pre === 1 || pre === ' ')
          ? 'explicit_space'
          : (!pre ? intentPre : undefined);
    const bodyStr = w.capture(() => this.toTrimmedString(options));
    const post = this.post !== undefined
      ? w.capture(() => this.processPrePost('post', '', options))
      : (intentPost === undefined && trivia
          ? w.capture(() => emitTrivia(trivia.after, this.location[3], options))
          : '');
    const postIntent = this.post === 0
      ? 'explicit_none'
      : (this.post === 1 || post === ' ')
          ? 'explicit_space'
          : (!post ? intentPost : undefined);

    let result = pre + bodyStr + post;
    if (preIntent) {
      w.signalBoundaryIntent('pre', preIntent);
    }
    if (postIntent) {
      w.signalBoundaryIntent('post', postIntent);
    }
    // Trim output if flag is set
    w.add(result, this);
    return w.getSince(mark);
  }

  /**
   * Renders evaluated output for this node through the context-owned print
   * state. This is the live-binding render path, not a source serializer.
   */
  render(context: Context, options?: PrintOptions): string {
    const prepared = prepareContextPrintState(context, options);
    const resolved = this.resolve(context);
    if (!isThenable(resolved)) {
      return resolved.toTrimmedString(prepared);
    }
    const printOptions = getPrintOptions(prepared);
    return this.toTrimmedString(printOptions);
  }

  /**
   * The authored body form of the node without outer pre/post comments and
   * whitespace.
   *
   * @note - Internally, this still calls `toString()` on each value,
   * so that the internal spacing of the node serialization is
   * correct. This method just serializes a node without the outer
   * pre/post nodes, and does not require a render context.
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

  /**
   * Individual node types will override this.
   *
   * This is just a default implementation.
   * 0 = equal (==)
   * 1 = greater than (>)
   * -1 = less than (<)
   * undefined = not comparable
   */
  compare(b: Node, context?: Context): 0 | 1 | -1 | undefined {
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
  operate(b: Node, op: Operator, context: Context): Node {
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
