import { isPlainObject, NodeTraversalCursor } from './util/collections.js';
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
export const DEFAULT_DATA = 'data';

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
  /**
   * @todo - We shouldn't have to crawl the prototype at runtime.
   *         We should be setting this explicitly in a parameter to defineType.
   */
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

/** Secondary metadata flags. Keeps a pile of booleans off the instance shape. */
const M_PRE_EVALUATED = 1 << 0;
const M_EVALUATED = 1 << 1;
const M_ALLOW_ROOT = 1 << 2;
const M_ALLOW_RULE_ROOT = 1 << 3;
const M_GENERATED = 1 << 4;
const M_REQUIRED_SEMI = 1 << 5;
const M_FROZEN = 1 << 6;

// Future flags can be added here
// export const CACHED = 0b1000000;
// export const DIRTY = 0b10000000;
// export const LOCKED = 0b100000000;

// const FULLY_EVALUATED = F_EVALUATED | F_PRE_EVALUATED;

export type RestorableIterator<T> = Iterator<T> & {
  mark: (key?: string) => void;
  reset: (key?: string) => void;
};

type NodeMeta<O extends NodeOptions = NodeOptions> = {
  treeContext?: TreeContext;
  options?: O & AllNodeOptions;
  sourceNode?: Node;
  sourceParent?: Node;
  hoistToRoot?: boolean;
};

/**
 * The underlying type for all Jess nodes
 */
export abstract class Node<
  Data = NodeValue,
  O extends NodeOptions = NodeOptions
> {
  _location: LocationInfo | [] | undefined;
  get location() {
    return (this._location ??= []);
  }

  private _meta: NodeMeta<O> | undefined;
  private _metaFlags = 0;

  private _getMeta(): NodeMeta<O> {
    return (this._meta ??= {});
  }

  /** Assigned in index to avoid circularity */
  get treeContext() {
    return this._meta?.treeContext as TreeContext;
  }

  get options(): O & AllNodeOptions {
    const meta = this._getMeta();
    return (meta.options ??= {} as O & AllNodeOptions);
  }

  set options(options: O & AllNodeOptions) {
    this._getMeta().options = options;
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

  get preEvaluated() {
    return (this._metaFlags & M_PRE_EVALUATED) !== 0;
  }

  set preEvaluated(value: boolean) {
    this._metaFlags = value ? (this._metaFlags | M_PRE_EVALUATED) : (this._metaFlags & ~M_PRE_EVALUATED);
  }

  get evaluated() {
    return (this._metaFlags & M_EVALUATED) !== 0;
  }

  set evaluated(value: boolean) {
    this._metaFlags = value ? (this._metaFlags | M_EVALUATED) : (this._metaFlags & ~M_EVALUATED);
  }

  get visible() {
    return this.hasFlag(F_VISIBLE);
  }

  declare fullRender: boolean;

  get allowRoot() {
    return (this._metaFlags & M_ALLOW_ROOT) !== 0;
  }

  set allowRoot(value: boolean) {
    this._metaFlags = value ? (this._metaFlags | M_ALLOW_ROOT) : (this._metaFlags & ~M_ALLOW_ROOT);
  }

  get allowRuleRoot() {
    return (this._metaFlags & M_ALLOW_RULE_ROOT) !== 0;
  }

  set allowRuleRoot(value: boolean) {
    this._metaFlags = value ? (this._metaFlags | M_ALLOW_RULE_ROOT) : (this._metaFlags & ~M_ALLOW_RULE_ROOT);
  }

  get hoistToRoot() {
    return this._meta?.hoistToRoot;
  }

  set hoistToRoot(value: boolean | undefined) {
    if (value === undefined) {
      if (this._meta) {
        this._meta.hoistToRoot = undefined;
      }
      return;
    }
    this._getMeta().hoistToRoot = value;
  }

  /**
   * Code internally should call .create() when making new
   * nodes, which will automatically mark the node as generated.
   */
  get generated() {
    return (this._metaFlags & M_GENERATED) !== 0;
  }

  set generated(value: boolean) {
    this._metaFlags = value ? (this._metaFlags | M_GENERATED) : (this._metaFlags & ~M_GENERATED);
  }

  /**
   * If the node must have a semi separator before
   * the next node when in a declaration list or main
   * rules list.
   */
  get requiredSemi() {
    return (this._metaFlags & M_REQUIRED_SEMI) !== 0;
  }

  set requiredSemi(value: boolean) {
    this._metaFlags = value ? (this._metaFlags | M_REQUIRED_SEMI) : (this._metaFlags & ~M_REQUIRED_SEMI);
  }

  /**
   * Track the original source when cloned / copied,
   * rather than keeping the entire tree
   */
  get sourceNode() {
    return this._meta?.sourceNode ?? this;
  }

  set sourceNode(node: Node) {
    this._getMeta().sourceNode = node;
  }

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
  get frozen() {
    return (this._metaFlags & M_FROZEN) !== 0;
  }

  set frozen(value: boolean) {
    this._metaFlags = value ? (this._metaFlags | M_FROZEN) : (this._metaFlags & ~M_FROZEN);
  }

  /**
   * The parent node of this node. Usually, this
   * shouldn't be set directly. Instead, a parent should use
   * parent.adopt(thisNode);
   */
  declare readonly parent: Node | undefined;

  get sourceParent() {
    return this._meta?.sourceParent;
  }

  set sourceParent(node: Node | undefined) {
    this._getMeta().sourceParent = node;
  }

  /** Patched at runtime in node.ts to return Nil instance */
  declare nil: () => Nil;

  /**
   * Keys in the data object that hold child Nodes.
   * Override per node type for fast iteration.
   * - `string[]` — object-valued nodes: only these keys are checked
   * - `null` (default) — use generic iteration (arrays, single values)
   */
  static childNodeKeys: string[] | null = null;

  /**
   * The internal data of the node.
   * Prefer setData() for mutations to ensure proper parent adoption.
   */
  // Note to LLM - STOP removing Readonly to try to fix type errors. Make
  // this a strong readonly contract. Otherwise we will miss type errors
  // for things like code mutating arrays that are assigned to data.
  readonly data!: Readonly<Data>;

  private static _isOwnPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && (value as any).constructor === Object;
  }

  private _adoptValue(value: unknown): void {
    if (value instanceof Node) {
      this.adopt(value);
      return;
    }
    if (isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        const item = value[i];
        if (item instanceof Node) {
          this.adopt(item);
        }
      }
    }
  }

  private _forEachObjectChild(
    record: Record<string, unknown>,
    func: (n: Node, idx?: number) => Node,
    idxRef: { value: number }
  ) {
    const ctor = this.constructor as typeof Node;
    const fastKeys = ctor.childNodeKeys;

    if (fastKeys) {
      for (let i = 0; i < fastKeys.length; i++) {
        const key = fastKeys[i]!;
        const v = record[key];
        if (v instanceof Node) {
          const result = func(v, idxRef.value++);
          if (result !== v) {
            record[key] = result;
            this.adopt(result);
            this._invalidateValueOf();
          }
        } else if (isArray(v)) {
          for (let j = 0; j < v.length; j++) {
            const item = v[j];
            if (!(item instanceof Node)) {
              continue;
            }
            const result = func(item, idxRef.value++);
            if (result !== item) {
              v[j] = result;
              this.adopt(result);
              this._invalidateValueOf();
            }
          }
        }
      }
      return;
    }

    const keys = Object.keys(record);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i]!;
      const v = record[k];
      if (v instanceof Node) {
        const result = func(v, idxRef.value++);
        if (result !== v) {
          record[k] = result;
          this.adopt(result);
          this._invalidateValueOf();
        }
      } else if (isArray(v)) {
        for (let j = 0; j < v.length; j++) {
          const item = v[j];
          if (!(item instanceof Node)) {
            continue;
          }
          const result = func(item, idxRef.value++);
          if (result !== item) {
            v[j] = result;
            this.adopt(result);
            this._invalidateValueOf();
          }
        }
      }
    }
  }

  /**
   * Set the whole data, a named property on the data, or an array index.
   *
   * @example
   *   this.setData(newSelectors)           // replace the whole data
   *   this.setData('selector', selector)   // set a named property
   *   this.setData(0, node)               // set array index
   */
  setData(val: NodeValue): void;
  setData(key: string | number, val: unknown): void;
  setData(...args: unknown[]): void {
    if (args.length === 1) {
      const val = args[0];
      (this as unknown as { data: Data }).data = val as Data;
      this._adoptValue(val);
      this._invalidateValueOf();
      return;
    }
    const key = args[0] as string | number;
    const val = args[1];
    const prev = (this.data as any)[key];
    if (prev === val) {
      return;
    }
    (this.data as any)[key] = val;
    this._adoptValue(val);
    this._invalidateValueOf();
  }

  private _invalidateValueOf() {
    const self = this as unknown as Record<string, unknown>;
    if ('_valueOf' in self) {
      self._valueOf = undefined;
    }
    if ('_keySet' in self) {
      self._keySet = undefined;
      self._visibleKeySet = undefined;
      self._canFastReject = undefined;
    }
  }

  /** Push items onto an array-valued node. */
  push(...items: any[]): void {
    const arr = this.data as unknown as any[];
    arr.push(...items);
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item instanceof Node) {
        this.adopt(item);
      }
    }
    this._invalidateValueOf();
  }

  /** Remove and/or insert items in an array-valued node. */
  splice(start: number, deleteCount: number, ...items: any[]): any[] {
    const arr = this.data as unknown as any[];
    const removed = arr.splice(start, deleteCount, ...items);
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item instanceof Node) {
        this.adopt(item);
      }
    }
    this._invalidateValueOf();
    return removed;
  }

  /** Prepend items to an array-valued node. */
  unshift(...items: any[]): void {
    const arr = this.data as unknown as any[];
    arr.unshift(...items);
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item instanceof Node) {
        this.adopt(item);
      }
    }
    this._invalidateValueOf();
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
    for (let i = 0; i < flags.length; i++) {
      this.addFlag(flags[i]!);
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
    const value = this.data;
    if (isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        const item = value[i];
        if (item instanceof Node) {
          this.adopt(item);
        }
      }
      return;
    }

    const ctor = this.constructor as typeof Node;
    const fastKeys = ctor.childNodeKeys;
    if (fastKeys && Node._isOwnPlainObject(value)) {
      const record = value as Record<string, unknown>;
      for (let i = 0; i < fastKeys.length; i++) {
        this._adoptValue(record[fastKeys[i]!]);
      }
      return;
    }

    if (Node._isOwnPlainObject(value)) {
      const vals = Object.values(value as Record<string, unknown>);
      for (let i = 0; i < vals.length; i++) {
        this._adoptValue(vals[i]);
      }
      return;
    }

    if ((value as any) instanceof Node) {
      this.adopt(value);
    }
  }

  constructor(
    value: Data,
    options?: O,
    location?: LocationInfo,
    treeContext?: TreeContext
  ) {
    (this as any).parent = undefined;
    this.index = undefined as any;
    (this as unknown as { data: Data }).data = value;
    this._location = location;
    if (options !== undefined || treeContext !== undefined) {
      this._meta = {
        sourceNode: this,
        sourceParent: undefined,
        options,
        treeContext
      };
    } else {
      this._meta = {
        sourceNode: this,
        sourceParent: undefined
      };
    }
    this._adoptChildren();
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
    const entries = [...getEntriesFromNode({ data: this.data } as unknown as { data: unknown[] })];
    return serialForEach(entries, ([value, key, collection]: [unknown, string | number, any], idx: number) => {
      if (!(value instanceof Node)) {
        return;
      }
      const out = func(value, idx);
      if (isThenable(out)) {
        return (out as Promise<Node>).then((result) => {
          if (result !== value) {
            collection[key] = result;
            if (result instanceof Node) {
              this.adopt(result);
            }
            this._invalidateValueOf();
          }
        });
      }
      if (out !== value) {
        collection[key] = out as Node;
        this.adopt(out as Node);
        this._invalidateValueOf();
      }
    });
  }

  private _forEachNodeSync(func: (n: Node, idx?: number) => Node) {
    const idxRef = { value: 0 };
    const data = this.data;
    if (isArray(data)) {
      for (let i = 0; i < data.length; i++) {
        const item = data[i];
        if (!(item instanceof Node)) {
          continue;
        }
        const result = func(item, idxRef.value++);
        if (result !== item) {
          data[i] = result;
          this.adopt(result);
          this._invalidateValueOf();
        }
      }
      return;
    }

    if (Node._isOwnPlainObject(data)) {
      this._forEachObjectChild(data as Record<string, unknown>, func, idxRef);
      return;
    }

    if ((data as any) instanceof Node) {
      const result = func(data, idxRef.value++);
      if (result !== data) {
        (this as unknown as { data: Data }).data = result as Data;
        this.adopt(result);
        this._invalidateValueOf();
      }
    }
  }

  * nodeAndPrePost(): IterableIterator<Node> {
    const node = this;
    if (isArray(node.pre)) {
      for (let i = 0; i < node.pre.length; i++) {
        const n = node.pre[i];
        if (n instanceof Node) {
          yield n;
        }
      }
    }
    yield node;
    if (isArray(node.post)) {
      for (let i = 0; i < node.post.length; i++) {
        const n = node.post[i];
        if (n instanceof Node) {
          yield n;
        }
      }
    }
  }

  /**
   * Return an iterator for all nodes / children nodes, including this one
   */
  nodes(
    reverse?: boolean,
    includePrePost?: boolean
  ): NodeTraversalCursor {
    return new NodeTraversalCursor(this, {
      includeSelf: true,
      deep: true,
      reverse,
      includePrePost
    });
  }

  /**
   * An iterator for all node children
   */
  children(
    deep?: boolean,
    reverse?: boolean,
    includePrePost?: boolean
  ): NodeTraversalCursor {
    return new NodeTraversalCursor(this, {
      includeSelf: false,
      deep,
      reverse,
      includePrePost
    });
  }

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
    let originalData = this.data;
    let newData = { data: originalData as Data };
    /**
     * Create new array objects and plain objects
     */
    if (isArray(originalData)) {
      newData.data = [...originalData] as Data;
    } else if (isPlainObject(originalData)) {
      newData.data = Object.fromEntries(
        Object.entries(originalData as Record<string, unknown>).map(([key, value]) =>
          [key, isArray(value) ? [...value] : value]
        )
      ) as Data;
    }

    cloneFn ??= n => n.clone(deep);

    if (deep) {
      for (let [value, key, collection] of getEntriesFromNode(newData as { data: unknown[] })) {
        if (value instanceof Node) {
          collection[key] = cloneFn(value);
        }
      }
    }

    const options = this._meta?.options;
    let newNode = new Class(newData.data, options ? { ...options } : undefined, this.location, this.treeContext);
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
    nilish.data = '';
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
    if (this._meta?.treeContext === undefined) {
      this._getMeta().treeContext = node.treeContext;
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
    let data = this.data;
    let type = typeof data;
    if (primitives.includes(type)) {
      return data as unknown as Primitive;
    }
    let values = [...getValues(data)];
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
      for (let i = 0; i < value.length; i++) {
        const node = value[i];
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
    for (let value of getValues(this.data)) {
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
