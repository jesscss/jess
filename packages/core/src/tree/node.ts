import isPlainObject from 'lodash-es/isPlainObject';
import {
  type TreeContext,
  type Context
} from '../context';
import { type Visitor } from '../visitor';
import { type Operator } from './util/calculate';
import type { Class, AbstractClass, Tagged } from 'type-fest';
import type { Nil } from './nil';
import { getEntriesFromNode, getValues } from './util/collections';
import type { Comment } from './comment';
import { type PrintOptions, getPrintOptions } from './util/print';

export type { TreeContext };

const { isArray } = Array;

type AllNodeOptions = {
  hoistToRoot?: boolean;
  /**
   * This seems harder to implement. For now, for anything that needs
   * to be flattened, we hoist it to the root.
   */
  // hoistToParent?: boolean

  /**
   * For statements with optional semis,
   * we flag this for accurate re-serialization.
   */
  semi?: boolean;
};

/**
 * @todo - Clean up and delete these types and symbols, if not used.
 */
export type Primitive = undefined | boolean | string | number | ((...args: any[]) => any);

export const ABORT: unique symbol = Symbol('ABORT');
export const REMOVE: unique symbol = Symbol('REMOVE');
export const IS_PROXY: unique symbol = Symbol('IS_PROXY');
export type NodeVisitReturn = void | Node | symbol;
export type NodeOptions = Record<string, any> & AllNodeOptions;
export const DEFAULT_DATA = 'value';

type BasicNodeTypes = Primitive | Node;
type NodeRecordValue = BasicNodeTypes | Array<BasicNodeTypes | Primitive[]> | Record<string, any>;
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

/**
 * @todo I think the only utility for this now is we collect
 * the types of nodes in the tree at first evaluation time.
 */
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

  let proto: any = Clazz;
  let types = proto.types = new Set();
  while (proto?.type) {
    types.add(proto.type);
    proto = Object.getPrototypeOf(proto);
  }

  type Args = [value?: P[0] | V, options?: P[1], location?: P[2]];
  return (...args: Args) => {
    const node = new (Clazz as any)(...args) as T extends Class<infer C> ? InstanceType<Class<C, Args>> : never;
    (node as any).type = type;
    (node as any).shortType = shortType;
    return node;
  };
};

export type ConditionOperator = 'and' | 'or' | '=' | '>' | '<' | '>=' | '<=';

export type NoOverride<T> = Tagged<T, 'NoOverride'>;

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
   * Assigned on the prototype, make sure we don't initialize
   */
  abstract type: string;
  abstract shortType: string;
  get types(): Set<string> {
    return (this.constructor as any).types;
  }

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
  pre: Array<Comment | Nil | string> | 1 | 0 | undefined;
  post: Array<Comment | Nil | string> | 1 | 0 | undefined;

  /** Will be copied during inherit */
  stateRules = ['visible', 'evaluated', 'preEvaluated'];
  declare renderInvisible: boolean;
  visible = true;
  evaluated = false;
  preEvaluated = false;

  allowRoot = false;
  allowRuleRoot = false;

  /**
   * Code internally should call .create() when making new
   * nodes, which will automatically mark the node as generated.
   */
  generated = false;

  /**
   * When evaluating, nodes are assigned an index by the Rules node.
   * This is used for lookup order. Note, this _will_ be undefined
   * initially, but we assign it in the Rules node, which is also
   * where we read it, so this makes the type easier.
   */
  index!: number;

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

  /** The parent node of this node */
  parent: Node | undefined;

  nil!: () => Nil;

  protected _value: Data;

  /**
   * This is the internal `data` of the node.
   */
  get value(): Data {
    return this._value;
  }

  set value(val: Data) {
    this._value = this._tryProxyWrap(val);
  }

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
            if (returnVal[IS_PROXY]) {
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
          return Reflect.set(target, prop, newValue);
        }
      }) as T;
    }

    return this._processNodes(value);
  }

  /**
   * Assign parent to sub-nodes
   * @note - This will not process the children nodes of children nodes.
   */
  private _processNodes<T>(value: T): T {
    for (let val of getValues(value)) {
      if (val instanceof Node) {
        val.parent = this;
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
    this._value = this._tryProxyWrap(value);
    this._treeContext = treeContext;
    this._location = location;
    this._options = options;

    // Make sourceNode non-enumerable to avoid JSON serialization issues
    Object.defineProperties(this, {
      sourceNode: {
        value: this,
        writable: true,
        enumerable: false,
        configurable: false
      }
    });
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

  /**
   * Mutates node children in place. Used by eval()?
   *
   * Processed nodes must always return a Node.
   */
  async forEachNode(func: (n: Node) => Node | Promise<Node>) {
    for (let [value, key, collection] of getEntriesFromNode(this as { value: unknown[] })) {
      if (value instanceof Node) {
        collection[key] = await func(value);
      }
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
    for (let nodeVal of getValues(this.value, reverse)) {
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
   * @todo - Is this right? Visitors only get callbacks for children?
   *         I should check the original Less visitor pattern.
   */
  accept(visitor: Visitor) {
    for (let node of this.children()) {
      visitor.visit(node);
    }
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
    let originalValue = this.value;
    let newValue = this.value;
    /**
     * Create new array objects and plain objects
     */
    if (isArray(originalValue)) {
      newValue = [...originalValue] as Data;
    } else if (isPlainObject(originalValue)) {
      let map = new Map(Object.entries(originalValue as Record<string, unknown>));
      for (let [key, value] of map.entries()) {
        if (isArray(value)) {
          map.set(key, [...value]);
        }
      }
      newValue = Object.fromEntries(map) as Data;
    }
    let newNode = new Class(newValue, { ...this.options }, this.location, this.treeContext);
    newNode.inherit(this);

    cloneFn ??= n => n.clone(deep);

    if (deep) {
      for (let [value, key, collection] of getEntriesFromNode(newNode as { value: unknown[] })) {
        if (value instanceof Node) {
          collection[key] = cloneFn(value);
        }
      }
    }

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
    const nilish = Object.create(this.constructor.prototype);
    nilish.type = 'Nil';
    nilish.visible = false;
    nilish.value = '';
    return nilish;
  }

  /**
   * Same as clone except comments are stripped.
   * This is used for variable referencing and
   * selector extending.
   */
  copy(deep?: boolean): this {
    const newNode = this.clone(
      deep,
      (n) => {
        if (n.type !== 'Comment') {
          const copy = n.copy(deep);
          return copy;
        }
        const nilNode = this.nil?.() || this._createMinimalNil();
        return nilNode.inherit(n);
      }
    );
    newNode.stripPrePost(newNode, 'pre');
    newNode.stripPrePost(newNode, 'post');
    return newNode;
  }

  /**
   * `preEval` is used for things like interpolated variables
   * in declaration names, mixin names, interpolated strings in imports etc.
   *
   * In other words, values that must be evaluated before other nodes
   * are evaluated.
   */
  async preEval(context: Context): Promise<this> {
    this.preEvaluated = true;
    return this;
  }

  preEvalSync(context: Context): this {
    // Default: indicate async required if a sync path isn't implemented by subclass
    throw new Error('AsyncRequired');
  }

  /**
   * This is the method all nodes will override.
   * Individual nodes will specify / narrow return type
   *
   * By default, evals all children
   */
  async evalNode(context: Context): Promise<Node> {
    let node = this.maybeClone(context);
    await node.forEachNode(async n => await n.evalNode(context));
    return node;
  }

  // Sync-first API: fast-paths should implement these; default throws
  evalNodeSync(context: Context): Node {
    // Default: indicate async required
    throw new Error('AsyncRequired');
  }

  static async evalStatic(node: Node, context: Context): Promise<Node> {
    let returnNode: Node = node;
    if (!node.preEvaluated) {
      returnNode = await node.preEval(context);
      if (returnNode !== node) {
        returnNode.inherit(node);
      }
      returnNode.preEvaluated = true;
    }
    if (!returnNode.evaluated) {
      returnNode = await returnNode.evalNode(context);
      if (returnNode !== node) {
        returnNode.inherit(node);
      }
      returnNode.preEvaluated = true;
      returnNode.evaluated = true;
    }
    return returnNode;
  }

  static evalStaticSync(node: Node, context: Context): Node {
    let returnNode: Node = node;
    if (!node.preEvaluated) {
      if (typeof (node as any).preEvalSync !== 'function') {
        throw new Error('AsyncRequired');
      }
      returnNode = (node as any).preEvalSync(context);
      if (returnNode !== node) {
        returnNode.inherit(node);
      }
      returnNode.preEvaluated = true;
    }
    if (!returnNode.evaluated) {
      if (typeof (returnNode as any).evalNodeSync !== 'function') {
        throw new Error('AsyncRequired');
      }
      returnNode = (returnNode as any).evalNodeSync(context);
      if (returnNode !== node) {
        returnNode.inherit(node);
      }
      returnNode.preEvaluated = true;
      returnNode.evaluated = true;
    }
    return returnNode;
  }

  /**
   * @note - Make sure you don't call super.eval while evaluating a node. Call it indirectly
   * from another node.
   */
  async eval(context: Context): Promise<Node> {
    if (Object.getPrototypeOf(this).eval !== Node.prototype.eval) {
      throw new Error('Do not call super.eval() from a subclass.');
    }
    return await Node.evalStatic(this, context);
  }

  evalSync(context: Context): Node {
    return Node.evalStaticSync(this, context);
  }

  /**
   * @note - this should be used if we're conditionally evaluating
   * and then inheriting. It allows you to call eval() without
   * penalty, if you're not sure if a node has been evaluated.
   */
  protected async evalIfNot<T extends Node = Node>(context: Context, func: () => T | Promise<T>): Promise<T> {
    if (!this.evaluated) {
      let node = await func();
      if (!node.evaluated) {
        node.inherit(this);
        node.evaluated = true;
      }
      return node;
    }
    return this as unknown as T;
  }

  /**
   * This is used when a Node will replace another node.
   */
  inherit(node: Node) {
    this._location = node.location;
    this._treeContext = node.treeContext;
    /** Copy any state rules */
    for (let rule of this.stateRules || []) {
      (this as any)[rule] = (node as any)[rule];
    }
    this.evaluated &&= node.evaluated;
    this.preEvaluated &&= node.preEvaluated;
    // Note that we need to create new arrays if we mutate pre/post later
    this.pre = node.pre;
    this.post = node.post;
    this.sourceNode = node.sourceNode;
    this.index ??= node.index;
    this.parent = node.parent;
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
  valueOf(): string | number {
    let value = this.value;
    let type = typeof value;
    if (type === 'string') {
      return value as string;
    } else if (type === 'number') {
      return value as number;
    }
    let values = [...getValues(value)];
    if (values.length === 1) {
      return `${values[0]}`;
    }
    return values.join('');
  }

  processPrePost(key: 'pre' | 'post', defaultVal: string = '', options?: PrintOptions) {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    let value = this[key];
    if (value === undefined) {
      if (defaultVal) w.add(defaultVal);
      return w.getSince(mark);
    } else if (value === 0) {
      return '';
    } else if (value === 1) {
      w.add(' ');
      return w.getSince(mark);
    } else if (isArray(value)) {
      // Handle Node[] array - call toString() on each node (they will emit into writer)
      const stripWS = false; // rollback aggressive whitespace stripping
      for (let node of value) {
        if (node instanceof Node) {
          node.toString(options);
        } else {
          const s = String(node);
          if (stripWS && /^\s+$/.test(s)) continue;
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
    if (!this.visible && !this.renderInvisible) {
      return '';
    }
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    this.processPrePost('pre', '', options);
    const bodyMark = w.mark();
    const bodyStr = this.toTrimmedString(options);
    const bodyEmitted = w.getSince(bodyMark);
    if (bodyEmitted.length === 0 && bodyStr) {
      w.add(bodyStr);
    }
    this.processPrePost('post', '', options);
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
        if (s) w.add(s, this);
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
    return aVal > bVal ? 1 : -1;
  }

  /** Overridden in index.ts to avoid circularity */
  operate(b: Node, op: Operator, context: Context): Node {
    return this;
  }

  /** @todo - Still needed? */
  static numericCompare(a: number, b: number) {
    if (a === b) {
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
Node.prototype.renderInvisible = false;