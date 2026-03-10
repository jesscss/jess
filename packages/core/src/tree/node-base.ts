import isPlainObject from 'lodash-es/isPlainObject.js';
import {
  type TreeContext,
  type Context
} from '../context.js';
import { type Visitor } from '../visitor/index.js';
import { type Operator } from './util/calculate.js';
import type { Class, AbstractClass, Tagged } from 'type-fest';
import { getEntriesFromNode, getValues } from './util/collections.js';
import type { Comment } from './comment.js';
import { type PrintOptions, getPrintOptions } from './util/print.js';
import { type MaybePromise, pipe, isThenable, serialForEach } from '@jesscss/awaitable-pipe';
import type { Rules } from './rules.js';
import type { Nil } from './nil.js';
import { nodeTypeBits } from './node-type.js';
export type { TreeContext };

const { isArray } = Array;
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
  (Clazz as any).type = type;
  (Clazz as any).shortType = shortType;

  /** Build nodeType bitmask by OR-ing bits for each type in the prototype chain */
  let nodeType = 0;
  let proto: any = Clazz;
  while (proto?.type) {
    const bit = nodeTypeBits[proto.type];
    if (bit !== undefined) {
      nodeType |= bit;
    }
    proto = Object.getPrototypeOf(proto);
  }
  /** Set on the prototype so ALL instances (including `new Foo()`) inherit it */
  Clazz.prototype.nodeType = nodeType;
  Clazz.prototype.type = type;
  Clazz.prototype.shortType = shortType;

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

  private _options: O & AllNodeOptions | undefined;
  get options(): O & AllNodeOptions {
    return (this._options ??= {} as O & AllNodeOptions);
  }

  set options(options: O & AllNodeOptions) {
    this._options = options;
  }

  /**
   * Assigned on the prototype by defineType — do NOT initialize in subclasses
   * (an `= 'X'` would create an own property that shadows the prototype value).
   * Use interface merging to declare the literal type per node class.
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
   * rules list.
   */
  _requiredSemi = false;
  get requiredSemi() {
    return this._requiredSemi;
  }

  set requiredSemi(value: boolean) {
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
  declare sourceParent: Node | undefined;

  /** Patched at runtime in node.ts to return Nil instance */
  declare nil: () => Nil;

  protected _value: Data;

  /**
   * Keys in the value object that hold child Nodes.
   * Override per node type for fast iteration.
   * - `string[]` — object-valued nodes: only these keys are checked
   * - `null` (default) — use generic iteration (arrays, single values)
   */
  static childNodeKeys: string[] | null = null;

  /**
   * This is the internal `data` of the node.
   * Prefer setValue() for mutations to ensure proper parent adoption.
   */
  get value(): Data {
    return this._value;
  }

  set value(val: Data) {
    this._value = val;
    this._adoptChildren();
    // Invalidate memoized valueOf() on selector-like nodes after mutation.
    if ('_valueOf' in this) {
      (this as unknown as { _valueOf?: unknown })._valueOf = undefined;
    }
  }

  /**
   * Set the whole value, or a named property on the value.
   *
   * @example
   *   this.set(newSelectors)           // replace the whole value
   *   this.set('selector', selector)   // set a named property
   */
  setValue(val: Data): void;
  setValue<K extends keyof Data>(key: K, val: Data[K]): void;
  setValue(...args: any[]): void {
    if (args.length === 1) {
      this.value = args[0];
      return;
    }
    const [key, val] = args;
    (this._value as any)[key] = val;
    if (val instanceof Node) {
      this.adopt(val);
    }
    if ('_valueOf' in this) {
      (this as unknown as { _valueOf?: unknown })._valueOf = undefined;
    }
  }

  /**
   * Get mutable access to the internal value.
   * Use when you need direct array/object mutation (push, splice, etc.)
   * and will handle adopt() yourself.
   */
  get mutableValue(): Data {
    return this._value;
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
   * Adopt all child Nodes in the value.
   * Uses static childNodeKeys when available for fast path.
   */
  private _adoptChildren(): void {
    const keys = (this.constructor as typeof Node).childNodeKeys;
    if (keys) {
      const val = this._value as Record<string, unknown>;
      for (let i = 0; i < keys.length; i++) {
        const child = val[keys[i]!];
        if (child instanceof Node) {
          this.adopt(child);
        }
      }
    } else {
      for (let val of getValues(this._value)) {
        if (val instanceof Node) {
          this.adopt(val);
        }
      }
    }
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
      },
      sourceParent: {
        value: undefined,
        writable: true,
        enumerable: false,
        configurable: false
      }
    });
    this._value = value;
    this._adoptChildren();
    this._treeContext = treeContext;
    this._location = location;
    this._options = options;
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
    let node = this.parent;
    let sourceParent = this.sourceParent;
    while (node && !sourceParent) {
      node = node.parent;
      sourceParent = node?.sourceParent;
    }
    return sourceParent?.rulesParent;
  }

  /**
   * Mutates node children in place. Used by eval()?
   *
   * Processed nodes must always return a Node.
   */
  forEachNode(func: (n: Node, idx?: number) => MaybePromise<Node>) {
    if (!this.hasFlag(F_MAY_ASYNC)) {
      return this._forEachNodeSync(func as (n: Node, idx?: number) => Node);
    }
    const entries = [...getEntriesFromNode({ value: this._value } as { value: unknown[] })];
    return serialForEach(entries, ([value, key, collection]: [unknown, string | number, any], idx: number) => {
      if (!(value instanceof Node)) {
        return;
      }
      const out = func(value, idx);
      if (isThenable(out)) {
        return (out as Promise<Node>).then((result) => {
          collection[key] = result;
        });
      }
      collection[key] = out as Node;
    });
  }

  private _forEachNodeSync(func: (n: Node, idx?: number) => Node) {
    let idx = 0;
    for (const [value, key, collection] of getEntriesFromNode({ value: this._value } as { value: unknown[] })) {
      if (!(value instanceof Node)) {
        continue;
      }
      collection[key] = func(value, idx++);
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
    const keys = (this.constructor as typeof Node).childNodeKeys;
    if (keys) {
      const val = this._value as Record<string, unknown>;
      for (let i = 0; i < keys.length; i++) {
        const nodeVal = val[keys[i]!];
        if (nodeVal instanceof Node) {
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
    } else {
      for (let nodeVal of getValues(this._value, reverse)) {
        if (nodeVal instanceof Node) {
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

  /**
   * @todo
   * Write tests that make sure that a maybe clone without preserveOriginalNodes
   * does not clone the nodes, but a maybeClone with preserveOriginalNodes
   * does clone the nodes all through the tree.
   */
  maybeClone(context: Context, deep?: boolean, cloneFn?: (n: Node) => Node): this {
    if (context.preserveOriginalNodes) {
      return this.clone(deep, cloneFn);
    }
    return this;
  }

  clonedEval(context: Context): MaybePromise<Node> {
    let preserveNodes = context.preserveOriginalNodes;
    context.preserveOriginalNodes = true;
    let out = this.eval(context);
    if (isThenable(out)) {
      return (out as Promise<Node>).then((result) => {
        context.preserveOriginalNodes = preserveNodes;
        return result;
      });
    }
    context.preserveOriginalNodes = preserveNodes;
    return out;
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
    let originalValue = this._value;
    let newValue = { value: originalValue as Data };
    /**
     * Create new array objects and plain objects
     */
    if (isArray(originalValue)) {
      newValue.value = [...originalValue] as Data;
    } else if (isPlainObject(originalValue)) {
      let map = new Map(Object.entries(originalValue as Record<string, unknown>));
      for (let [key, value] of map.entries()) {
        if (isArray(value)) {
          map.set(key, [...value]);
        }
      }
      newValue.value = Object.fromEntries(map) as Data;
    }

    cloneFn ??= n => n.clone(deep);

    if (deep) {
      /** I think GetEntriesOf is not typed correctly, thus neither is getEntriesFromNode */
      for (let [value, key, collection] of getEntriesFromNode(newValue as { value: unknown[] })) {
        if (value instanceof Node) {
          collection[key] = cloneFn(value);
        }
      }
    }

    let newNode = new Class(newValue.value, this._options ? { ...this._options } : undefined, this.location, this.treeContext);
    newNode.inherit(this);

    return newNode;
  }

  /** Remove comments from pre/post */
  stripPrePost(n: Node, preOrPost: 'pre' | 'post') {
    const prePost = n[preOrPost];
    if (isArray(prePost)) {
      n[preOrPost] = [...prePost];
      for (let [key, node] of prePost.entries()) {
        if (node instanceof Node && node.type === 'Comment') {
          /** Replace comment with a nil node that inherits location */
          const nilNode = this.nil?.() || this._createMinimalNil();
          prePost[key] = nilNode.inherit(node);
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
      let node = this.maybeClone(context);
      node.preEvaluated = true;

      // Note: Rules nodes handle index assignment for themselves and their children
      // Other nodes will get indices assigned by their parent Rules
      let out: MaybePromise<void>;
      try {
        out = node.forEachNode(n => n.preEval(context));
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
    });
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

    if (!node.hasFlag(F_MAY_ASYNC)) {
      return Node._evalStaticSync(node, context);
    }

    let preEvaluatedNode: Node;

    return pipe(
      () => {
        if (!node.preEvaluated) {
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
        if (!preEvaluatedNode.evaluated) {
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

  private static _evalStaticSync(node: Node, context: Context): Node {
    let preEvaluatedNode: Node;

    if (!node.preEvaluated) {
      preEvaluatedNode = node.preEval(context) as Node;
    } else {
      preEvaluatedNode = node;
    }
    preEvaluatedNode.preEvaluated = true;
    if (preEvaluatedNode !== node) {
      preEvaluatedNode.inherit(node);
    }

    let evald: Node;
    if (!preEvaluatedNode.evaluated) {
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
    this.sourceNode = node.sourceNode;
    this.sourceParent ??= node.sourceParent;
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
      return value as unknown as Primitive;
    }
    let values = [...getValues(value)];
    if (values.length === 1) {
      return `${values[0]}`;
    }
    return values.join('');
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
   * This re-serializes the node, if needed. Will
   * likely be over-ridden in some cases.
   *
   * Note that this is the "as-is" representation of the
   * node, not the "evaluated" version.
   *
   * Note that the ToCssVisitor will be a little
   * more sophisticated, as it will re-format
   * to some extent by replacing newlines + spacing
   * with the appropriate amount of whitespace.
   *
   * @note toString() will, by default, include pre/post
   * white-space and comments, to make serialization
   * easy.
   *
   * In almost all Node cases, this should not be overriden,
   * and toTrimmedString() should be overridden instead.
   */
  toString(options?: PrintOptions): string {
    if (!this.hasFlag(F_VISIBLE) && !this.fullRender) {
      return '';
    }
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    let pre = w.capture(() => this.processPrePost('pre', '', options));
    const bodyStr = w.capture(() => this.toTrimmedString(options));
    let post = w.capture(() => this.processPrePost('post', '', options));

    let result = pre + bodyStr + post;
    // Trim output if flag is set
    w.add(result, this);
    return w.getSince(mark);
  }

  /**
   * The form of the node without pre/post comments and white-space
   *
   * @note - Internally, this still calls `toString()` on each value,
   * so that the internal spacing of the node serialization is
   * correct. This method just serializes a node without the outer
   * pre/post nodes.
   */
  toTrimmedString(options?: PrintOptions) {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    for (let value of getValues(this.value)) {
      if (value instanceof Node) {
        value.toString(options);
      } else {
        const s = value === undefined ? '' : String(value);
        if (s) {
          w.add(s, this);
        }
      }
    }
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