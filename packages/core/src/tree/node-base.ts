import { NodeTraversalCursor } from './util/collections.js';
import {
  type TreeContext,
  type Context
} from '../context.js';
import { type Visitor } from '../visitor/index.js';
import { type Operator } from './util/calculate.js';
import type { AbstractClass, Tagged } from 'type-fest';
import type { Comment } from './comment.js';
import { type PrintOptions, getPrintOptions } from './util/print.js';
import { type MaybePromise, pipe, isThenable, serialForEach } from '@jesscss/awaitable-pipe';
import type { Rules } from './rules.js';
import type { Nil } from './nil.js';
import { N, nodeTypeBits } from './node-type.js';
import { addParentEdge } from './util/cursor.js';
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
 * Values returned by {@link Node.location}: a full six-number span, or `[]` when unknown.
 * The empty tuple is the lazy default assigned by the `location` getter.
 */
export type LocationInfoOrEmpty = LocationInfo | [];

/**
 * Location argument for node construction and APIs that accept another node's `location`.
 * Same shape as {@link LocationInfoOrEmpty}, or `undefined` to defer to the empty default.
 */
export type OptionalLocation = LocationInfoOrEmpty | undefined;

export type RenderKey = number | symbol;

export const CANONICAL: unique symbol = Symbol('CANONICAL');
export const EVAL: unique symbol = Symbol('EVAL');
export const CALLER: unique symbol = Symbol('CALLER');

export type NodeEdge<T> = Map<RenderKey, T>;

export type Cursor = {
  node: Node;
  renderKey: RenderKey;
};

function isContextArg(value: Context | RenderKey | undefined): value is Context {
  return typeof value === 'object' && value !== null && 'rulesetFrames' in value;
}

function getActiveParentFromContext(
  node: Node,
  context?: Context
): Node | undefined {
  if (!context) {
    return node.parent;
  }
  const keys: RenderKey[] = [];
  const push = (key: RenderKey | undefined): void => {
    if (key === undefined || key === CANONICAL || keys.includes(key)) {
      return;
    }
    keys.push(key);
  };
  push(context.renderKey);
  push(context.rulesContext?.renderKey);
  push(node.renderKey);
  if (node.parentEdges?.has(EVAL)) {
    push(EVAL);
  }
  for (const key of keys) {
    const parent = node.parentEdges?.get(key);
    if (parent !== undefined) {
      return parent;
    }
  }
  return node.parent;
}

function hasTypeProperty(value: unknown): value is { type?: string } {
  return (typeof value === 'object' || typeof value === 'function')
    && value !== null
    && 'type' in value;
}

function getNodeChildKeys(node: Node): readonly string[] | null | undefined {
  const childKeys: readonly string[] | null | undefined = Reflect.get(node.constructor, 'childKeys');
  return childKeys;
}

function getNodeBag(node: Node): Record<string, unknown> {
  return node as unknown as Record<string, unknown>;
}

function getNodeField<T = unknown>(node: Node, key: string): T {
  return getNodeBag(node)[key] as T;
}

function setNodeField(node: Node, key: string, value: unknown): void {
  const bag = getNodeBag(node);
  if (bag[key] === value) {
    return;
  }
  bag[key] = value;
}

function getNodeEdge<T>(node: Node, key: string): NodeEdge<T> | undefined {
  return getNodeBag(node)[key] as NodeEdge<T> | undefined;
}

function getNodeEdgeList(node: Node, key: string): Array<NodeEdge<unknown> | undefined> | undefined {
  return getNodeBag(node)[key] as Array<NodeEdge<unknown> | undefined> | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getNodeValue(node: Node): unknown {
  return getNodeField(node, 'value');
}

export function canReuseEvalState(node: Node, context?: Context): boolean {
  const renderKey = context?.renderKey;
  if (renderKey === undefined || renderKey === CANONICAL) {
    return true;
  }
  return node.renderKey === renderKey;
}

function setNodeEvaluated(node: Node, context?: Context): void {
  if (!canReuseEvalState(node, context)) {
    return;
  }
  setNodeField(node, 'evaluated', true);
}

function getNodeKeySetLibrary(node: Node): unknown {
  return getNodeBag(node).keySetLibrary;
}

function setNodeKeySetLibrary(node: Node, library: unknown): void {
  getNodeBag(node).keySetLibrary = library;
}

function isRulesNode(node: Node | undefined): node is Rules {
  return node?.type === 'Rules';
}

function toPrimitiveValue(value: unknown): Primitive {
  return (
    value === undefined
    || typeof value === 'string'
    || typeof value === 'number'
    || typeof value === 'boolean'
  )
    ? value
    : String(value);
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
  Reflect.set(Clazz, 'type', type);
  Reflect.set(Clazz, 'shortType', shortType);

  /** Build nodeType bitmask by OR-ing bits for each type in the prototype chain */
  let nodeType = 0;
  let proto: unknown = Clazz;
  /**
   * @todo - We shouldn't have to crawl the prototype at runtime.
   *         We should be setting this explicitly in a parameter to defineType.
   */
  while (hasTypeProperty(proto) && proto.type) {
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
    const node: InstanceType<T> = Reflect.construct(Clazz, args);
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

export function isVisibleInContext(node: Node, context?: Context): boolean {
  return context ? node._hasFlag(F_VISIBLE, context) : node.hasFlag(F_VISIBLE);
}

/** Secondary metadata flags. Keeps a pile of booleans off the instance shape. */
const M_ALLOW_ROOT = 1 << 0;
const M_ALLOW_RULE_ROOT = 1 << 1;
const M_GENERATED = 1 << 2;
const M_REQUIRED_SEMI = 1 << 3;
const M_FROZEN = 1 << 4;

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
  O extends NodeOptions = NodeOptions,
  ChildData extends Record<string, unknown> = Record<string, unknown>
> {
  _location: OptionalLocation;
  get location(): LocationInfoOrEmpty {
    return (this._location ??= []);
  }

  private _meta: NodeMeta<O> | undefined;
  private _metaFlags = 0;

  private _getMeta(): NodeMeta<O> {
    return (this._meta ??= {});
  }

  /** Assigned in index to avoid circularity */
  get treeContext() {
    return this._meta?.treeContext;
  }

  get options(): O & AllNodeOptions {
    const meta = this._getMeta();
    if (meta.options === undefined) {
      meta.options = Reflect.construct(Object, []);
    }
    return meta.options;
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

  preEvaluated = false;
  evaluated = false;
  declare stateEdges: Map<RenderKey, number> | undefined;

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
  declare parentEdges: NodeEdge<Node> | undefined;
  declare renderKey: RenderKey;

  get sourceParent() {
    return this._meta?.sourceParent;
  }

  set sourceParent(node: Node | undefined) {
    this._getMeta().sourceParent = node;
  }

  /** Patched at runtime in node.ts to return Nil instance */
  declare nil: () => Nil;

  /**
   * Keys of instance fields that hold child Nodes.
   * Override per node type.
   * - `undefined` (default) — unmigrated
   * - `null` — leaf node, no children to iterate/adopt/clone
   * - `string[]` — names of instance fields holding child Node(s) or Node[]
   */
  static childKeys: readonly string[] | null | undefined = undefined;

  /**
   * The internal data of the node.
   * Prefer setData() for mutations to ensure proper parent adoption.
   */
  // Note to LLM - STOP removing Readonly to try to fix type errors. Make
  // this a strong readonly contract. Otherwise we will miss type errors
  // for things like code mutating arrays that are assigned to data.
  // Uses `declare` to avoid emitting a class field initializer that would
  // shadow prototype getters on migrated subclasses.

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

  protected _invalidateValueOf(): void {
    if (Reflect.has(this, '_valueOf')) {
      Reflect.set(this, '_valueOf', undefined);
    }
    if (Reflect.has(this, '_keySet')) {
      Reflect.set(this, '_keySet', undefined);
      Reflect.set(this, '_visibleKeySet', undefined);
      Reflect.set(this, '_requiredKeySet', undefined);
    }
  }

  /**
   * Set the whole child payload, a named child field, or an indexed child item.
   * This is a canonical mutation compatibility seam; non-canonical mutation
   * should happen through derived nodes and keyed edges.
   */
  setData(val: NodeValue): void;
  setData(key: string | number, val: unknown): void;
  setData(...args: unknown[]): void {
    const childKeys = getNodeChildKeys(this);

    if (args.length === 1) {
      const val = args[0];
      if (Array.isArray(childKeys) && childKeys.length === 1) {
        setNodeField(this, childKeys[0]!, val);
      } else if (Array.isArray(childKeys) && val !== null && typeof val === 'object') {
        for (const key of childKeys) {
          if (Reflect.has(val, key)) {
            setNodeField(this, key, Reflect.get(val, key));
          }
        }
      } else {
        setNodeField(this, 'value', val);
      }
      this._adoptValue(val);
      this._invalidateValueOf();
      return;
    }

    const key = args[0];
    if (typeof key !== 'string' && typeof key !== 'number') {
      throw new TypeError('setData key must be a string or number');
    }
    const val = args[1];
    if (typeof key === 'number') {
      const arr = this._getArrayField();
      if (arr[key] === val) {
        return;
      }
      arr[key] = val;
    } else {
      const fields = this;
      if (fields[key] === val) {
        return;
      }
      fields[key] = val;
    }
    this._adoptValue(val);
    this._invalidateValueOf();
  }

  private _getArrayField(): unknown[] {
    const childKeys = getNodeChildKeys(this);
    if (!Array.isArray(childKeys) || childKeys.length === 0) {
      throw new Error(`${this.type} has no array child field`);
    }
    const key = childKeys[0]!;
    const value = getNodeField(this, key);
    if (!isArray(value)) {
      throw new Error(`${this.type}.${key} is not an array child field`);
    }
    return value;
  }

  push(ctx: Context, ...items: Node[]): void;
  push(...items: Node[]): void;
  push(ctxOrFirst: Context | Node, ...rest: Node[]): void {
    let ctx: Context | undefined;
    let items: Node[];
    if (ctxOrFirst instanceof Node) {
      items = [ctxOrFirst, ...rest];
    } else {
      ctx = ctxOrFirst;
      items = rest;
    }
    const arr = this._getArrayField();
    arr.push(...items);
    for (const item of items) {
      if (item instanceof Node) {
        this.adopt(item, ctx);
      }
    }
    this._invalidateValueOf();
  }

  splice(start: number, deleteCount: number, ...items: unknown[]): unknown[] {
    const arr = this._getArrayField();
    const removed = arr.splice(start, deleteCount, ...items);
    for (const item of items) {
      if (item instanceof Node) {
        this.adopt(item);
      }
    }
    this._invalidateValueOf();
    return removed;
  }

  unshift(...items: unknown[]): void {
    const arr = this._getArrayField();
    arr.unshift(...items);
    for (const item of items) {
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

  private _resolveRuntimeRenderKey(context: Context): RenderKey {
    if (context.renderKey !== undefined) {
      return context.renderKey;
    }
    if (this.renderKey !== CANONICAL) {
      return this.renderKey;
    }
    if (this.stateEdges?.has(EVAL)) {
      return EVAL;
    }
    return this.renderKey;
  }

  _hasFlag(flag: number, context: Context): boolean {
    const renderKey = this._resolveRuntimeRenderKey(context);
    if (renderKey === this.renderKey) {
      return this.hasFlag(flag);
    }
    const flags = this.stateEdges?.get(renderKey) ?? this.state;
    return (flags & flag) !== 0;
  }

  _addFlag(flag: number, context: Context): void {
    const renderKey = this._resolveRuntimeRenderKey(context);
    if (renderKey === this.renderKey) {
      this.addFlag(flag);
      return;
    }
    const stateEdges = (this.stateEdges ??= new Map());
    let nextFlags = (stateEdges.get(renderKey) ?? this.state) | flag;
    if (flag === F_NON_STATIC) {
      nextFlags &= ~F_STATIC;
    }
    stateEdges.set(renderKey, nextFlags);
  }

  _removeFlag(flag: number, context: Context): void {
    const renderKey = this._resolveRuntimeRenderKey(context);
    if (renderKey === this.renderKey) {
      this.removeFlag(flag);
      return;
    }
    const stateEdges = (this.stateEdges ??= new Map());
    stateEdges.set(renderKey, (stateEdges.get(renderKey) ?? this.state) & ~flag);
  }

  adopt(node: Node, ctx?: Context) {
    if (!node.frozen) {
      const renderKey = ctx?.renderKey;
      if (renderKey !== undefined && renderKey !== CANONICAL) {
        const existing = node.parentEdges?.get(renderKey);
        if (existing !== this) {
          const edge = node.parentEdges ?? new Map<RenderKey, Node>();
          edge.set(renderKey, this);
          node.parentEdges = edge;
        }
      } else {
        setNodeField(node, 'parent', this);
      }
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

  constructor(
    value: Data,
    options?: O,
    location?: OptionalLocation,
    treeContext?: TreeContext
  ) {
    setNodeField(this, 'parent', undefined);
    setNodeField(this, 'renderKey', CANONICAL);
    this.index = undefined!;
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
  }

  /**
   * Type-safe access to child data fields.
   * Without a second arg: returns canonical (parse-time) value.
   * With a renderKey: returns edge-selected value if one exists.
   * With a context: returns edge-selected value first, then any eval-state-patched value.
   *
   * @example
   *   url.get('value')              // canonical, typed
   *   url.get('value', renderKey)   // render-path aware, typed
   *   url.get('value', ctx)         // render + eval-state aware, typed
   *   url.get('name')               // TS error if 'name' not in ChildData
   */
  get<K extends keyof ChildData & string>(key: K): ChildData[K];
  get<K extends keyof ChildData & string>(key: K, renderKey: RenderKey | undefined): ChildData[K];
  get<K extends keyof ChildData & string>(key: K, ctx: Context | undefined): ChildData[K];
  get<K extends keyof ChildData & string>(key: K, ctxOrRenderKey?: Context | RenderKey | undefined): ChildData[K] {
    const ctx = isContextArg(ctxOrRenderKey) ? ctxOrRenderKey : undefined;
    const explicitRenderKey = !isContextArg(ctxOrRenderKey)
      ? ctxOrRenderKey
      : undefined;
    const canonicalValue = getNodeField<ChildData[K]>(this, key);
    if (
      !ctx
      && (explicitRenderKey === undefined || explicitRenderKey === CANONICAL)
      && this.renderKey === CANONICAL
    ) {
      return canonicalValue;
    }
    const renderKeys: RenderKey[] = [];
    const pushRenderKey = (renderKey: RenderKey | undefined) => {
      if (renderKey === undefined || renderKey === CANONICAL || renderKeys.includes(renderKey)) {
        return;
      }
      renderKeys.push(renderKey);
    };
    pushRenderKey(explicitRenderKey);
    pushRenderKey(ctx?.renderKey);
    pushRenderKey(ctx?.rulesContext?.renderKey);
    pushRenderKey(this.renderKey !== CANONICAL ? this.renderKey : undefined);
    const singularEdge = getNodeEdge<ChildData[K]>(this, `${key}Edge`);
    const indexedEdges = isArray(canonicalValue)
      ? getNodeEdgeList(this, `${key}Edges`)
      : undefined;
    if (
      ctx
      && (singularEdge?.has(EVAL)
        || indexedEdges?.some(edge => edge?.has(EVAL))
      )
    ) {
      pushRenderKey(EVAL);
    }

    for (const renderKey of renderKeys) {
      const overridden = singularEdge?.get(renderKey);
      if (overridden !== undefined) {
        return overridden;
      }
      if (indexedEdges) {
        let resolved: ChildData[K] | undefined;
        for (let i = 0; i < canonicalValue.length; i++) {
          const item = indexedEdges[i]?.get(renderKey);
          if (item !== undefined) {
            if (!resolved) {
              const nextResolved: ChildData[K] = [...canonicalValue];
              resolved = nextResolved;
            }
            resolved[i] = item;
          }
        }
        if (resolved) {
          return resolved;
        }
      }
    }

    return canonicalValue;
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
    const instance: InstanceType<T> = Reflect.construct(this, [value, options, location, treeContext]);

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
  forEachNode(func: (n: Node, idx?: number) => MaybePromise<Node>, context?: Context) {
    if (!this.hasFlag(F_MAY_ASYNC)) {
      return this._forEachNodeSync(func, context);
    }
    const entries = this._collectChildEntries();
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

  private _collectChildEntries(): [unknown, string | number, any][] {
    const ck = getNodeChildKeys(this);
    if (!ck) {
      return [];
    }
    const entries: [unknown, string | number, any][] = [];
    for (const key of ck) {
      const field = getNodeField(this, key);
      if (isArray(field)) {
        for (let i = 0; i < field.length; i++) {
          entries.push([field[i], i, field]);
        }
      } else {
        entries.push([field, key!, this]);
      }
    }
    return entries;
  }

  private _forEachNodeSync(func: (n: Node, idx?: number) => Node, _context?: Context) {
    const ck = getNodeChildKeys(this);

    if (Array.isArray(ck)) {
      let idx = 0;
      for (const key of ck) {
        const field = getNodeField(this, key);
        if (isArray(field)) {
          for (let i = 0; i < field.length; i++) {
            const item = field[i];
            if (!(item instanceof Node)) {
              continue;
            }
            const result = func(item, idx++);
            if (result !== item) {
              field[i] = result;
              this.adopt(result);
              this._invalidateValueOf();
            }
          }
        } else if (field instanceof Node) {
          const result = func(field, idx++);
          if (result !== field) {
            setNodeField(this, key, result);
            this.adopt(result);
            this._invalidateValueOf();
          }
        }
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
    const treeVisitMethod = Reflect.get(visitor, '_visit');
    const hasTreeVisitorState = Reflect.get(visitor, 'visitedNodes') instanceof Set;
    const visitMethod = Reflect.get(visitor, 'visit');
    if (typeof treeVisitMethod === 'function' && hasTreeVisitorState) {
      const visited: NodeVisitReturn = treeVisitMethod.call(visitor, this, {});
      result = visited;
    } else if (typeof visitMethod === 'function') {
      const visited: Node = visitMethod.call(visitor, this);
      result = visited;
    } else {
      const maybeAbort = visitor.enter?.(this);
      if (maybeAbort === ABORT) {
        return this;
      }
      const methodName = this.type.charAt(0).toLowerCase() + this.type.slice(1);
      const typeMethod = Reflect.get(visitor, methodName);
      if (typeof typeMethod === 'function') {
        const visited: NodeVisitReturn = typeMethod.call(visitor, this);
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

  clone(deep?: boolean, cloneFn?: (n: Node) => Node, ctx?: Context): this {
    const ck = getNodeChildKeys(this);

    // Leaf node — no children to iterate or deep-clone
    if (ck === null) {
      const options = this._meta?.options;
      const newNode: this = Reflect.construct(this.constructor, [getNodeValue(this), options ? { ...options } : undefined, this.location, this.treeContext]);
      newNode.inherit(this);
      return newNode;
    }

    // Container — build constructor value from childKeys
    let cloneData: unknown;
    let cloneRecord: Record<string, unknown> | undefined;
    if (ck!.length === 1) {
      const field = getNodeField(this, ck![0]!);
      cloneData = isArray(field) ? [...field] : field;
    } else {
      cloneRecord = {};
      cloneData = cloneRecord;
      for (const key of ck!) {
        const field = getNodeField(this, key);
        cloneRecord[key] = isArray(field) ? [...field] : field;
      }
    }

    if (deep) {
      cloneFn ??= n => n.clone(deep);
      if (ck!.length === 1) {
        if (isArray(cloneData)) {
          for (let i = 0; i < cloneData.length; i++) {
            if (cloneData[i] instanceof Node) {
              cloneData[i] = cloneFn(cloneData[i]);
            }
          }
        } else if (cloneData instanceof Node) {
          cloneData = cloneFn(cloneData);
        }
      } else {
        const cloneObject = cloneRecord;
        for (const key of ck!) {
          const val = cloneObject?.[key];
          if (isArray(val)) {
            for (let i = 0; i < val.length; i++) {
              if (val[i] instanceof Node) {
                val[i] = cloneFn(val[i]);
              }
            }
          } else if (val instanceof Node) {
            if (cloneObject) {
              cloneObject[key] = cloneFn(val);
            }
          }
        }
      }
    }

    // When eval state is active and this is a shallow clone, the constructor will call
    // adopt() for all child nodes without ctx, which directly mutates their parent fields.
    // Save the pre-construction parent values so we can restore them after, routing the
    // new parent assignment through the eval state instead.
    let priorChildParents: [Node, Node | undefined][] | undefined;
    if (!deep && ctx) {
      priorChildParents = [];
      if (isArray(cloneData)) {
        for (const item of cloneData) {
          if (item instanceof Node) {
            priorChildParents.push([item, item.parent]);
          }
        }
      } else if (cloneData instanceof Node) {
        priorChildParents.push([cloneData, cloneData.parent]);
      } else if (isRecord(cloneData)) {
        for (const key of ck!) {
          const field = cloneData[key];
          if (field instanceof Node) {
            priorChildParents.push([field, field.parent]);
          } else if (isArray(field)) {
            for (const item of field) {
              if (item instanceof Node) {
                priorChildParents.push([item, item.parent]);
              }
            }
          }
        }
      }
    }

    const options = this._meta?.options;
    const newNode: this = Reflect.construct(this.constructor, [cloneData, options ? { ...options } : undefined, this.location, this.treeContext]);

    // Reconnect shallow-cloned children on the active render path without
    // mutating canonical parent pointers.
    if (priorChildParents) {
      const renderKey = ctx!.renderKey ?? this.renderKey;
      for (const [child, priorParent] of priorChildParents) {
        if (renderKey !== undefined) {
          addParentEdge(child, renderKey, newNode);
        }
        setNodeField(child, 'parent', priorParent);
      }
    }

    newNode.inherit(this);
    Node._inheritDerivedParent(this, newNode, ctx);
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
      let node = this.clone();
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
        return Promise.resolve(out).then(() => node).catch((error: unknown) => {
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
      return Promise.resolve(out).then(() => {
        return this;
      });
    }
    return this;
  }

  static evalStatic(node: Node, context: Context): MaybePromise<Node> {
    const reusableState = canReuseEvalState(node, context);
    if (node.hasFlag(F_STATIC) && node.evaluated && reusableState) {
      return node;
    }

    if (!node.hasFlag(F_MAY_ASYNC)) {
      return Node._evalStaticSync(node, context);
    }

    let preEvaluatedNode: Node;

    return pipe(
      () => {
        if (!node.preEvaluated || !reusableState) {
          return node.preEval(context);
        }
        return node;
      },
      (preEvald) => {
        preEvaluatedNode = preEvald;
        if (canReuseEvalState(preEvaluatedNode, context)) {
          preEvaluatedNode.preEvaluated = true;
        }
        if (preEvald !== node) {
          Node._inheritDerivedRenderKey(node, preEvaluatedNode, context);
          preEvaluatedNode.inherit(node);
          Node._inheritDerivedParent(node, preEvaluatedNode, context);
        }
        if (!preEvaluatedNode.evaluated || !canReuseEvalState(preEvaluatedNode, context)) {
          return preEvaluatedNode.evalNode(context);
        }
        return preEvaluatedNode;
      },
      (evald) => {
        setNodeEvaluated(evald, context);
        if (preEvaluatedNode !== evald && typeof evald.inherit === 'function') {
          Node._inheritDerivedRenderKey(preEvaluatedNode, evald, context);
          if (Node._shouldInheritEvalResult(preEvaluatedNode, evald)) {
            evald.inherit(preEvaluatedNode);
            Node._inheritDerivedParent(preEvaluatedNode, evald, context);
          }
        }
        return evald;
      }
    );
  }

  private static _evalStaticSync(node: Node, context: Context): Node {
    let preEvaluatedNode: Node;
    const reusableState = canReuseEvalState(node, context);

    if (!node.preEvaluated || !reusableState) {
      preEvaluatedNode = node.preEval(context);
    } else {
      preEvaluatedNode = node;
    }
    if (canReuseEvalState(preEvaluatedNode, context)) {
      preEvaluatedNode.preEvaluated = true;
    }
    if (preEvaluatedNode !== node) {
      Node._inheritDerivedRenderKey(node, preEvaluatedNode, context);
      preEvaluatedNode.inherit(node);
      Node._inheritDerivedParent(node, preEvaluatedNode, context);
    }

    let evald: Node;
    if (!preEvaluatedNode.evaluated || !canReuseEvalState(preEvaluatedNode, context)) {
      evald = preEvaluatedNode.evalNode(context);
    } else {
      evald = preEvaluatedNode;
    }
    setNodeEvaluated(evald, context);
    if (preEvaluatedNode !== evald && typeof evald.inherit === 'function') {
      Node._inheritDerivedRenderKey(preEvaluatedNode, evald, context);
      if (Node._shouldInheritEvalResult(preEvaluatedNode, evald)) {
        evald.inherit(preEvaluatedNode);
        Node._inheritDerivedParent(preEvaluatedNode, evald, context);
      }
    }
    return evald;
  }

  private static _shouldInheritEvalResult(source: Node, result: Node): boolean {
    if (source.type !== 'Reference') {
      return true;
    }
    return (result.nodeType & (N.Mixin | N.Ruleset | N.Rules | N.Func | N.JsFunction)) === 0;
  }

  private static _inheritDerivedRenderKey(source: Node, derived: Node, context?: Context): void {
    if (source === derived || derived.renderKey !== CANONICAL) {
      return;
    }
    derived.renderKey = source.renderKey === CANONICAL
      ? (context?.renderKey ?? EVAL)
      : source.renderKey;
  }

  private static _inheritDerivedParent(source: Node, derived: Node, context?: Context): void {
    if (source === derived) {
      return;
    }
    setNodeField(derived, 'parent', getActiveParentFromContext(source, context));
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
      setNodeField(this, 'parent', node.parent);
    } else {
      if (this.parent === undefined) {
        setNodeField(this, 'parent', node.parent);
      }
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
    if (node.hoistToRoot) {
      this.hoistToRoot = true;
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
  valueOf(_context?: Context): Primitive {
    const ck = getNodeChildKeys(this);
    if (!ck) {
      // Leaf node — value is a primitive
      return toPrimitiveValue(getNodeValue(this));
    }
    // Container — collect string values from children
    const parts: string[] = [];
    for (const key of ck) {
      const field = getNodeField(this, key);
      if (isArray(field)) {
        for (let i = 0; i < field.length; i++) {
          parts.push(`${field[i]}`);
        }
      } else if (field !== undefined) {
        parts.push(`${field}`);
      }
    }
    if (parts.length === 1) {
      return parts[0]!;
    }
    return parts.join('');
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
  toString(options?: PrintOptions, _renderKey?: RenderKey): string {
    if (!isVisibleInContext(this, options?.context) && !this.fullRender) {
      return '';
    }
    if (options?.suppressComments && this.type === 'Comment') {
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
   * Serialize the evaluated tree. Requires context so position patches
   * (the virtual evaluated tree) are resolved during serialization.
   *
   * Use this instead of toString() when serializing eval results.
   * toString() serializes the canonical (parsed) tree without eval state.
   */
  render(options?: PrintOptions | Context, renderKey?: RenderKey): string {
    const normalizedOptions = isContextArg(options)
      ? { context: options }
      : options;
    return this.toString(normalizedOptions, renderKey);
  }

  /**
   * The form of the node without pre/post comments and white-space
   *
   * @note - Internally, this still calls `toString()` on each value,
   * so that the internal spacing of the node serialization is
   * correct. This method just serializes a node without the outer
   * pre/post nodes.
   *
   * @todo - Simplify
   */
  toTrimmedString(options?: PrintOptions, _renderKey?: RenderKey) {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    const ck = getNodeChildKeys(this);
    const ctx = options.context;
    if (ck) {
      for (const key of ck) {
        // Resolve through eval state when context available
        const field = ctx
          ? this.get(key! as keyof ChildData & string, ctx)
          : getNodeField(this, key);
        if (isArray(field)) {
          for (const item of field) {
            if (item instanceof Node) {
              item.toString(options);
            } else {
              const s = item === undefined ? '' : String(item);
              if (s) {
                w.add(s, this);
              }
            }
          }
        } else if (field instanceof Node) {
          field.toString(options);
        } else {
          const s = field === undefined ? '' : String(field);
          if (s) {
            w.add(s, this);
          }
        }
      }
    } else {
      // Leaf node — render the primitive value directly
      const s = String(getNodeValue(this) ?? '');
      if (s) {
        w.add(s, this);
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
    let aVal = this.valueOf(context);
    let bVal = b.valueOf(context);
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
