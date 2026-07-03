import {
  type TreeContext,
  type Context
} from '../context.js';
import type { TriviaMap } from '../types/index.js';
import { type Visitor } from '../visitor/index.js';
import { type Operator } from './util/calculate.js';
import type { AbstractClass, Tagged } from 'type-fest';
import {
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
  writeRenderText,
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

export type Primitive = undefined | boolean | string | number;
export type PrimitiveOrFunc = Primitive | ((...args: any[]) => any);

export const ABORT: unique symbol = Symbol('ABORT');
export const REMOVE: unique symbol = Symbol('REMOVE');
export type NodeVisitReturn = void | Node | symbol;
export type NodeOptions = Record<string, any> & AllNodeOptions;
export type RegistrationOptions = {
  reuseCanonical?: boolean;
};
export type PlacementCloneOptions = {
  /**
   * Omit comments by cloning them as Nil nodes for variable/reference-style
   * placement copies.
   */
  stripComments?: boolean;
  /**
   * Reuse source-free scalar leaves instead of allocating identical copies.
   */
  reuseLeaves?: boolean;
};

type BasicNodeTypes = PrimitiveOrFunc | Node;
type NodeRecordValue = BasicNodeTypes | Array<BasicNodeTypes | PrimitiveOrFunc[]> | Record<string, any>;
export type NodeValueObject = Record<string, NodeRecordValue>;
export type NodeValue = BasicNodeTypes | BasicNodeTypes[] | NodeValueObject;

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
  // nodeTypeBits.Rules is always defined; `!` non-null assert: it's set in the table
  return node instanceof Node && (node.nodeType & nodeTypeBits.Rules!) !== 0;
}

function hasFrameMetadata(node: Node): node is FrameMetadataNode {
  return 'frames' in node;
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

type TreeVisitMethod = (node: Node, ctx?: unknown) => NodeVisitReturn;
type VisitMethod = (node: Node) => Node;
type TypeVisitMethod = (node: Node) => NodeVisitReturn;
type FrameMetadataNode = Node & {
  frames?: unknown;
};

function getTreeVisitMethod(visitor: unknown): TreeVisitMethod | undefined {
  if (typeof visitor !== 'object' || visitor === null) {
    return undefined;
  }
  const method = (visitor as { _visit?: unknown })._visit;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return typeof method === 'function' ? method as TreeVisitMethod : undefined;
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
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return typeof method === 'function' ? method as VisitMethod : undefined;
}

function isStringKeyRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getTypeVisitMethod(visitor: unknown, methodName: string): TypeVisitMethod | undefined {
  if (!isStringKeyRecord(visitor)) {
    return undefined;
  }
  const method = visitor[methodName];
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return typeof method === 'function' ? method as TypeVisitMethod : undefined;
}

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
  // The abstract-class constraint is a compile-time nicety; every class passed
  // here is concrete, so construct it directly instead of through Reflect.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  const Concrete = Clazz as unknown as new (...args: Args) => InstanceType<T>;
  return (...args: Args): InstanceType<T> => {
    const node = new Concrete(...args);
    // Invariant 7: the factory parents one level; the raw constructor did not.
    return args.length > 0 ? (node.parentChildren() as InstanceType<T>) : node;
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

/**
 * Flags a node bubbles up from its child nodes (see `propagateFlagsFrom`). A
 * faithful copy (`clone()`) PRESERVES these from its source — same structure ⇒
 * same flags — rather than recomputing them from children (that is eval-path
 * derivation, not copying). Canonical construction bubbles them via `adopt`.
 */
export const F_CHILD_DERIVED = F_MAY_ASYNC | F_STATIC | F_NON_STATIC | F_AMPERSAND | F_HAS_NODE_CHILD;

// Default state: only visible is true
export const F_DEFAULT = F_VISIBLE;

// Future flags can be added here
// export const CACHED = 0b1000000;
// export const DIRTY = 0b10000000;
// export const LOCKED = 0b100000000;

// const FULLY_EVALUATED = F_EVALUATED | F_PRE_EVALUATED;

type ValueBearingNode = Node & {
  value: unknown;
};

function hasNodeValue(node: Node): node is ValueBearingNode {
  return 'value' in node;
}

function childKeysOf(node: Node): readonly string[] | undefined {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  const childKeys = (node.constructor as typeof Node).childKeys;
  if (childKeys === null) {
    return undefined;
  }
  return childKeys;
}

function readNodeField(node: Node, key: string): unknown {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return (node as unknown as Record<string, unknown>)[key];
}

function visitValueEntries(
  value: unknown,
  cb: (node: Node, key: string | number, collection: any, idx: number) => void,
  idx: number,
  key: string | number,
  collection: any
): number {
  if (isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const item = value[i];
      if (item instanceof Node) {
        cb(item, i, value, idx++);
      }
    }
    return idx;
  }
  if (isPlainObject(value)) {
    for (const k in value) {
      const item = value[k];
      if (isArray(item)) {
        for (let i = 0; i < item.length; i++) {
          const child = item[i];
          if (child instanceof Node) {
            cb(child, i, item, idx++);
          }
        }
      } else if (item instanceof Node) {
        cb(item, k, value, idx++);
      }
    }
    return idx;
  }
  if (value instanceof Node) {
    cb(value, key, collection, idx++);
  }
  return idx;
}

function visitLeafValues(
  value: unknown,
  cb: (value: unknown) => void,
  reverse?: boolean
): void {
  if (isArray(value)) {
    if (reverse) {
      for (let i = value.length - 1; i >= 0; i--) {
        cb(value[i]);
      }
    } else {
      for (let i = 0; i < value.length; i++) {
        cb(value[i]);
      }
    }
    return;
  }
  if (isPlainObject(value)) {
    for (const k in value) {
      const item = value[k];
      if (isArray(item)) {
        if (reverse) {
          for (let i = item.length - 1; i >= 0; i--) {
            cb(item[i]);
          }
        } else {
          for (let i = 0; i < item.length; i++) {
            cb(item[i]);
          }
        }
      } else {
        cb(item);
      }
    }
    return;
  }
  cb(value);
}

/**
 * The underlying type for all Jess nodes
 */
export abstract class Node<
  out Data = unknown,
  out O extends NodeOptions = NodeOptions
> {
  /**
   * Keys of direct instance fields that hold child nodes.
   *
   * `null` marks a leaf with no child fields (the default). Every child-bearing
   * node class must declare its own list; there is no legacy `value` fallback.
   */
  static childKeys: readonly string[] | null = null;

  private _loc: NodeLocation | undefined = undefined;

  /**
   * Start/end source offsets, denormalized from the location tuple so hot
   * paths (trivia, serialization) read plain SMI fields instead of chasing the
   * tuple. `undefined` = no source location. Synced by the `_location` setter;
   * line/col slots ([1],[2],[4],[5]) may still be mutated in place on the
   * tuple, but offsets must be set by assigning the whole tuple.
   */
  spanStart: number | undefined = undefined;
  spanEnd: number | undefined = undefined;

  get _location(): NodeLocation | undefined {
    return this._loc;
  }

  set _location(location: NodeLocation | undefined) {
    this._loc = location;
    if (location !== undefined && location.length > 0) {
      this.spanStart = location[0];
      this.spanEnd = location[3];
    } else {
      this.spanStart = undefined;
      this.spanEnd = undefined;
    }
  }

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

  /** Bitmask of runtime flags (F_VISIBLE, F_STATIC, etc.). Renamed from `state` to free that name for Parséman. */
  flags = F_DEFAULT;

  /** Parséman parse-context snapshot stored per node for incremental re-parsing. */
  state: unknown = undefined;

  /** Discriminant required by Parséman's NodeLike interface. */
  readonly _tag = 'node' as const;

  /**
   * Parséman structural children (Node | CSTLeaf | CSTError items in parse order).
   * Set by buildNode during grammar-driven construction; empty for directly constructed nodes.
   */
  private _cstChildren: ReadonlyArray<{ _tag: string }> = [];
  get children(): ReadonlyArray<{ _tag: string }> {
    return this._cstChildren;
  }

  /** @internal — called by JessParser.buildNode only */
  _setCstChildren(children: ReadonlyArray<{ _tag: string }>) {
    this._cstChildren = children;
  }

  /** Source byte-offset span for Parséman's NodeLike interface. */
  get span(): { start: number; end: number } {
    return {
      start: this.spanStart ?? 0,
      end: this.spanEnd ?? 0
    };
  }

  /** Runtime tracking: has this node completed registration identity prep? */
  registrationPrepared = false;

  /** Runtime tracking: has eval been run on this node? */

  /**
   * Optional scanner-first direct-field spans, packed by this node's static
   * `childKeys` order as `[start, end, flags]` triples. This is offset-only
   * source provenance, not legacy `LocationInfo`.
   */
  declare fieldSpans: number[] | undefined;

  /**
   * Optional scanner-first spans for array-backed `value` entries, also packed
   * as `[start, end, flags]` triples. Keep this separate from `fieldSpans` so
   * a direct `value` field range is not confused with individual value
   * segments.
   */
  declare valueSpans: number[] | undefined;

  get visible() {
    return this.hasFlag(F_VISIBLE);
  }

  declare fullRender: boolean;

  /**
   * @todo - Move some to _meta?
   * Should do if some fields are not on the hot path
   * (not read very often)
   */
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
   * rather than keeping the entire tree. Plain data field (assigned in the
   * constructor) — the old per-instance `Object.defineProperties` was ~38x
   * slower and dominated node construction. `toJSON()` drops this + `parent`
   * so `JSON.stringify(node)` stays cycle-safe.
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
   *
   * Plain data field; dropped by `toJSON()` (see `sourceNode`) to keep
   * `JSON.stringify(node)` cycle-safe.
   */
  parent: Node | undefined = undefined;

  /**
   * `sourceNode` and `parent` are circular (a node is its own source; parent
   * points back up the tree). They were historically made non-enumerable via a
   * per-instance `Object.defineProperties` purely so `JSON.stringify(node)`
   * would not blow up. `JSON.stringify` honors `toJSON()` when present, so we
   * drop them here instead — avoiding both the ctor cost and any accessor on
   * the object shape.
   */
  toJSON(): Record<string, unknown> {
    const { sourceNode, parent, ...rest } = this;
    void sourceNode;
    void parent;
    return rest;
  }

  /** Patched at runtime in node.ts to return Nil instance */
  declare nil: () => Nil;

  /**
   * Add a flag to the node's state
   * Handles STATIC/NON_STATIC exclusivity automatically
   */
  addFlag(flag: number) {
    // NON_STATIC takes precedence over STATIC
    if (flag === F_STATIC && this.hasFlag(F_NON_STATIC)) {
      return;
    }
    this.flags |= flag;
    // Handle STATIC/NON_STATIC exclusivity
    if (flag === F_NON_STATIC) {
      this.flags &= ~F_STATIC;
    }
  }

  /**
   * Remove a flag from the node's flags
   */
  removeFlag(flag: number) {
    this.flags &= ~flag;
  }

  /**
   * Check if the node has a specific flag
   */
  hasFlag(flag: number): boolean {
    return (this.flags & flag) !== 0;
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
    const sourceRoot = sourceRootOf(this);
    if (sourceRoot && !node._sourceRoot) {
      node._sourceRoot = sourceRoot;
    }
    this.propagateFlagsFrom(node);
  }

  /**
   * OR a single direct child's propagated flags upward onto this node. This is
   * the FLAG concern only — NO reparenting. Separate from `adopt` (which also
   * sets `.parent`, canonical-only) so derived/eval nodes can recompute their
   * flags by crawling shared children without reparenting them.
   */
  propagateFlagsFrom(node: Node) {
    this.addFlag(F_HAS_NODE_CHILD);
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
  protected _processNodes<T>(value: T): T {
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
    value?: Data,
    options?: O,
    location?: NodeLocation
  ) {
    // Plain-field assignment (see `sourceNode` / `parent` / `toJSON`): a node is
    // its own source until cloned. `parent` defaults to `undefined` via its field
    // initializer. This replaces the old per-instance `Object.defineProperties`.
    this.sourceNode = this;
    //
    // Invariant 7: the base stores NOTHING and adopts NOTHING. Each concrete
    // node owns its own field values (its constructor assigns them); the
    // lowercase factory then calls `parentChildren()` to parent one level.
    // `new Foo()` shares its children by default.
    void value;
    this._location = location;
    this._options = options;
  }

  /**
   * Explicit, one-level parenting opt-in (invariant 7). Called by the canonical
   * factory after construction; NEVER by the raw `new Foo()` (which shares) nor
   * by eval-time construction. Drives parenting off `childKeys` so every
   * child-bearing node is handled by this ONE primitive:
   *   - `null`  → leaf, no child fields: no-op.
   *   - `[...]` → parent each listed direct child field, one level.
   */
  parentChildren(): this {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const childKeys = (this.constructor as typeof Node).childKeys;
    if (childKeys === null) {
      return this;
    }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const fields = this as unknown as Record<string, unknown>;
    for (let i = 0; i < childKeys.length; i++) {
      this._processNodes(fields[childKeys[i]!]);
    }
    return this;
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
      if (isRulesNode(possibleRules)) {
        break;
      }
      possibleRules = possibleRules.parent;
    }
    return isRulesNode(possibleRules) ? possibleRules : undefined;
  }

  get sourceRulesParent(): Rules | undefined {
    const directRulesParent = this.rulesParent;
    const frameFallbackNode = directRulesParent?._scopeFrame?.fallbackFrame?.rulesNode;
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

  /** Iterate leaf values from fields declared by childKeys. */
  private _visitValues(
    cb: (value: unknown) => void,
    reverse?: boolean
  ) {
    const childKeys = childKeysOf(this);
    if (!childKeys) {
      return;
    }
    if (reverse) {
      for (let i = childKeys.length - 1; i >= 0; i--) {
        visitLeafValues(readNodeField(this, childKeys[i]!), cb, reverse);
      }
      return;
    }
    for (let i = 0; i < childKeys.length; i++) {
      visitLeafValues(readNodeField(this, childKeys[i]!), cb);
    }
  }

  /**
   * Visit each child Node entry described by childKeys, calling `cb` for each.
   */
  private _visitEntries(
    cb: (node: Node, key: string | number, collection: any, idx: number) => void
  ) {
    const childKeys = childKeysOf(this);
    if (!childKeys) {
      return;
    }
    let idx = 0;
    for (let i = 0; i < childKeys.length; i++) {
      const key = childKeys[i]!;
      idx = visitValueEntries(readNodeField(this, key), cb, idx, key, this);
    }
  }

  private* _walkFromValue(
    value: unknown,
    deep?: boolean,
    reverse?: boolean
  ): Generator<Node, void, unknown> {
    if (isArray(value)) {
      if (reverse) {
        for (let i = value.length - 1; i >= 0; i--) {
          const nodeVal = value[i];
          if (nodeVal instanceof Node) {
            yield nodeVal;
            if (deep) {
              yield* nodeVal.walk(deep, reverse);
            }
          }
        }
      } else {
        for (let i = 0; i < value.length; i++) {
          const nodeVal = value[i];
          if (nodeVal instanceof Node) {
            yield nodeVal;
            if (deep) {
              yield* nodeVal.walk(deep, reverse);
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
                  yield* nodeVal.walk(deep, reverse);
                }
              }
            }
          } else {
            for (let i = 0; i < childValue.length; i++) {
              const nodeVal = childValue[i];
              if (nodeVal instanceof Node) {
                yield nodeVal;
                if (deep) {
                  yield* nodeVal.walk(deep, reverse);
                }
              }
            }
          }
        } else if (childValue instanceof Node) {
          yield childValue;
          if (deep) {
            yield* childValue.walk(deep, reverse);
          }
        }
      }
      return;
    }
    if (value instanceof Node) {
      yield value;
      if (deep) {
        yield* value.walk(deep, reverse);
      }
    }
  }

  /**
   * Return an iterator for all nodes / children nodes, including this one
   */
  * nodes(reverse?: boolean): Generator<Node, void, unknown> {
    yield this;
    yield* this.walk(true, reverse);
  }

  /**
   * An iterator over semantic child nodes (via childKeys), optionally deep.
   * Renamed from `children()` — use `.children` (property) for the Parséman structural child array.
   */
  * walk(deep?: boolean, reverse?: boolean): Generator<Node, void, unknown> {
    const childKeys = childKeysOf(this);
    if (!childKeys) {
      return;
    }
    if (reverse) {
      for (let i = childKeys.length - 1; i >= 0; i--) {
        yield* this._walkFromValue(readNodeField(this, childKeys[i]!), deep, reverse);
      }
      return;
    }
    for (let i = 0; i < childKeys.length; i++) {
      yield* this._walkFromValue(readNodeField(this, childKeys[i]!), deep, reverse);
    }
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
    for (const child of this.walk()) {
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
  /**
   * Shallow clone: a new node with this node's shape, SHARING its child nodes.
   * There is NO deep-clone option — the live-binding/placement layer is thin
   * replacement over a shared canonical source tree, never a sub-tree copy. A
   * caller may pass `cloneFn` to map its DIRECT child nodes (e.g. share a leaf,
   * substitute a single node); `cloneFn` must not recurse into a deep copy.
   */
  clone(cloneFn?: (n: Node) => Node): this {
    const applyMap = (v: unknown): unknown => {
      if (!cloneFn) {
        return v;
      }
      if (v instanceof Node) {
        return cloneFn(v);
      }
      this._mapChildNodes(v, cloneFn);
      return v;
    };
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const childKeys = (this.constructor as typeof Node).childKeys;
    // Multi-field nodes (childKeys other than a lone `value`) rebuild the
    // value-object their constructor expects from the direct child fields; the
    // base no longer mirrors those fields into `value`.
    const isMultiField = childKeys != null
      && !(childKeys.length === 1 && childKeys[0] === 'value');
    let cloned: unknown;
    if (isMultiField) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const fields = this as unknown as Record<string, unknown>;
      const obj: Record<string, unknown> = {};
      for (let i = 0; i < childKeys.length; i++) {
        const k = childKeys[i]!;
        obj[k] = applyMap(this.cloneValue(fields[k]));
      }
      cloned = obj;
    } else {
      if (!hasNodeValue(this)) {
        throw new TypeError(`${this.type} must implement clone() for direct fields`);
      }
      cloned = applyMap(this.cloneValue(this.value));
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const Ctor = this.constructor as new (
      value: unknown,
      options?: O,
      location?: NodeLocation
    ) => this;
    const newNode = new Ctor(
      cloned,
      this._options ? { ...this._options } : undefined,
      this._location
    );
    newNode.inherit(this);
    // Faithful copy: a clone shares/maps the SAME children as its source, so it
    // PRESERVES the source's child-derived flags rather than recomputing them.
    // clone() is an AST-copy primitive — it must not do eval-path derivation.
    newNode.flags = (newNode.flags & ~F_CHILD_DERIVED) | (this.flags & F_CHILD_DERIVED);

    return newNode;
  }

  /**
   * True when this node can be shared as an inert placement leaf.
   *
   * Containers still need an owned clone surface because eval may re-parent or
   * replace their children for a specific placement.
   */
  canReuseAsLeaf(): boolean {
    return this.spanStart === undefined
      && !this.hasFlag(F_NON_STATIC)
      && !this.hasFlag(F_HAS_NODE_CHILD);
  }

  reuseAsLeaf(): this {
    this.frozen = true;
    return this;
  }

  private _copyPlacementMetadataTo(target: Node): void {
    target.hoistToRoot = this.hoistToRoot;
    if (!hasFrameMetadata(this)) {
      return;
    }
    const self = this as FrameMetadataNode;
    const frames = self.frames;
    if (Array.isArray(frames)) {
      const frameCopy = new Array<unknown>(frames.length);
      for (let i = 0; i < frames.length; i++) {
        frameCopy[i] = frames[i];
      }
      (target as FrameMetadataNode).frames = frameCopy;
      return;
    }
    (target as FrameMetadataNode).frames = undefined;
  }

  /**
   * Clone this node for a new output/eval placement.
   *
   * Node shape belongs to `clone()` overrides. This method only applies
   * cross-cutting placement policy: comment stripping, reusable leaf sharing,
   * render metadata transfer, and freezing of copied surfaces.
   */
  cloneForPlacement(options?: PlacementCloneOptions): Node {
    const stripComments = options?.stripComments !== false;
    const reuseLeaves = options?.reuseLeaves !== false;
    if (stripComments && this.type === 'Comment') {
      return this.nil().inherit(this);
    }
    if (reuseLeaves && this.canReuseAsLeaf()) {
      return this.reuseAsLeaf();
    }
    // Thin placement: a new surface node that SHARES this node's child nodes.
    // Per-placement runtime state lives in side maps / the binding layer, never
    // in a deep-cloned sub-tree. We only map direct child nodes to apply
    // placement policy at this level (strip comments, reuse inert leaves); we do
    // NOT recurse into a deep copy.
    const clone = this.clone((n) => {
      if (stripComments && n.type === 'Comment') {
        return n.nil().inherit(n);
      }
      return reuseLeaves && n.canReuseAsLeaf() ? n.reuseAsLeaf() : n;
    });
    this._copyPlacementMetadataTo(clone);
    clone.frozen = true;
    return clone;
  }

  private _mapChildNodes(value: unknown, cloneFn: (n: Node) => Node) {
    if (isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        const item = value[i];
        if (item instanceof Node) {
          value[i] = cloneFn(item);
        } else if (isArray(item)) {
          this._mapChildNodes(item, cloneFn);
        }
      }
    } else if (isPlainObject(value)) {
      for (const k in value) {
        const v = value[k];
        if (v instanceof Node) {
          value[k] = cloneFn(v);
        } else if (isArray(v)) {
          this._mapChildNodes(v, cloneFn);
        } else if (isPlainObject(v)) {
          this._mapChildNodes(v, cloneFn);
        }
      }
    }
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
      const childKeys = childKeysOf(this);
      if (childKeys) {
        for (let i = 0; i < childKeys.length; i++) {
          this._detachChildTrivia(readNodeField(this, childKeys[i]!));
        }
      }
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
    // §2.7: a node is a reusable template that re-evaluates per placement — no
    // retained `evaluated` result on the canonical node. This removes the
    // `evaluated` re-eval/cache reads from the hot path. See LIVE_BINDING §2.7.
    if (!node.hasFlag(F_MAY_ASYNC)) {
      return Node._evalStaticSync(node, context);
    }

    const evaluated = node.evalNode(context);
    if (isThenable(evaluated)) {
      return (evaluated as Promise<Node>).then((evald) => {
        if (node !== evald) {
          evald.inherit(node);
        }
        return evald;
      });
    }
    if (node !== evaluated) {
      evaluated.inherit(node);
    }
    return evaluated;
  }

  private static _evalStaticSync(node: Node, context: Context): MaybePromise<Node> {
    const evaluated = node.evalNode(context);
    if (isThenable(evaluated)) {
      return (evaluated as Promise<Node>).then((resolved) => {
        const evald = mustBeNode(resolved);
        if (node !== evald) {
          evald.inherit(node);
        }
        return evald;
      });
    }
    const evald = mustBeNode(evaluated);
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
    this._location = node._location;
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
    // A detached-ruleset closure scope (captured at arg-binding) must survive the
    // placement clone/derive that produces the invoked surface. See
    // parseman-wrapper-is-scope-identity.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const closureScope = (node as unknown as { _closureScope?: unknown })._closureScope;
    if (closureScope !== undefined) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const self = this as unknown as { _closureScope?: unknown };
      self._closureScope ??= closureScope;
    }
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
    if (hasNodeValue(this)) {
      const value = this.value;
      if (isPrimitiveValue(value)) {
        return value;
      }
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
      emitTrivia(trivia, 'before', this.spanStart, options);
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
  render(context: Context, buffer: RenderBuffer, options?: PrintOptions): MaybePromise<string>;
  render(context: Context, options?: PrintOptions): MaybePromise<string>;
  render(context: Context, bufferOrOptions?: RenderBuffer | PrintOptions, options?: PrintOptions): MaybePromise<string> {
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
      ? prepareBufferPrintState(context, options)
      : prepareRenderPrintState(context, printOptions);
    const out = this.toTrimmedString(prepared);
    return buffer
      ? writeRenderText(buffer, out)
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

  /** @internal */
  writeSyntax(options: ReturnType<typeof getPrintOptions>): void {
    this.toTrimmedString(options);
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
}

/** When converting Less/Sass to Jess, we'll switch this flag temporarily */
Node.prototype.fullRender = false;
