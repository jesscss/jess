import { type Context } from '../context.js';
import { defineType, F_MAY_ASYNC, Node } from './node.js';
import { type PrintOptions, getPrintOptions } from './util/print.js';
import { compareNodeArray } from './util/compare.js';
import { type Operator } from './util/calculate.js';
import { LIST_ITEM_TRIM } from './util/regex.js';
import { isThenable, serialForEach, type MaybePromise } from '@jesscss/awaitable-pipe';
import { setField } from './util/field-helpers.js';

export type ListOptions = {
  /**
   * Lists can be separated by comma, semi-colon,
   * or slash, depending on the type of list.
   *
   * @todo - Is there a more CSS-y way to define this?
   */
  sep?: ',' | ';' | '/';
};

export type ListChildData<T extends Node = Node> = { value: T[] };

export interface List<T extends Node = Node> extends Node<T[], ListOptions, ListChildData<T>> {
  type: 'List';
  shortType: 'list';
  eval(context: Context): Promise<this>;
}

/**
 * A list of expressions
 *
 * i.e. one, two, three
 * or .sel, #id.class, [attr]
 * or one / two / three
 */
export class List<T extends Node = Node> extends Node<T[], ListOptions, ListChildData<T>> {
  static override childKeys = ['value'] as const;

  /** @internal */ value!: T[];

  constructor(value: T[], options?: ListOptions, location?: any, treeContext?: any) {
    super(value, options, location, treeContext);
    this.value = value;
    for (const child of value) {
      if (child instanceof Node) {
        this.adopt(child);
      }
    }
  }

  // NOTE: `length` intentionally remains canonical for now.
  // Unlike render/eval surfaces, it has no Context channel, so making it
  // state-aware would require a broader API change rather than a node-local patch.
  get length() {
    return this.value.length;
  }

  // NOTE: iteration intentionally remains canonical for now for the same reason as
  // `length`: there is no explicit Context channel on the iterator protocol.
  * [Symbol.iterator]() {
    yield* this.value.entries();
  }

  private _valueOf: string | undefined;

  // NOTE: `valueOf()` intentionally remains canonical for now.
  // It is a cached observer on the canonical list instance, and it has no
  // Context parameter. Making it state-aware here would make the cache
  // ambiguous across concurrent sessions that see different patched `value`s.
  override valueOf() {
    return (this._valueOf ??= this.value.map(v => v.valueOf()).join(';'));
  }

  override toTrimmedString(options?: PrintOptions) {
    options = getPrintOptions(options);
    const w = options.writer!;
    let { sep = ',' } = this.options ?? {};
    let value = this.get('value', options.context);
    let length = value.length;
    const mark = w.mark();
    if (value.length === 0) {
      return '';
    }
    // Print first item as-is
    let item = value[0]!;
    let out = w.capture(() => item.toString(options));
    w.add(out.replace(LIST_ITEM_TRIM, ''), item);
    // Subsequent items: emit sep; capture next item to decide spacing precisely
    for (let i = 1; i < length; i++) {
      item = value[i]!;
      if (sep === '/') {
        w.add(' / ');
      } else {
        w.add(`${sep} `);
      }
      out = (w.capture(() => item.toString(options))).replace(LIST_ITEM_TRIM, '');
      w.add(out);
    }
    return w.getSince(mark);
  }

  override compare(other: Node) {
    // NOTE: `compare()` intentionally remains canonical for now.
    if (other instanceof List) {
      const equalityMode = this.treeContext?.equalityMode ?? 'coerce';
      const result = compareNodeArray([...this.value], [...other.value], equalityMode);
      return result;
    }
    if (other.type === 'Any') {
      const normalize = (s: string) => s.replace(/;\s*/g, ', ').replace(/\s+/g, ' ').trim();
      const left = normalize(this.toString());
      const right = normalize(other.toString());
      return left === right ? 0 : undefined;
    }
    return undefined;
  }

  override operate(b: Node, op: Operator, context: Context): List<T> {
    if (op !== '+') {
      throw new Error(`List operation "${op}" not supported`);
    }
    const ownItems = this.get('value', context);
    const nextItems = b instanceof List ? b.get('value', context) : [b as T];
    let newList = this.maybeClone(context);
    setField(newList, 'value', [...ownItems, ...nextItems], context);
    return newList;
  }

  override preEval(context: Context): MaybePromise<Node> {
    if (this._isPreEvaluated(context)) {
      return this;
    }

    const node = this.maybeClone(context);
    node._setPreEvaluated(true, context);
    const value = node.get('value', context);
    const nextValue = value.slice();

    if (!node.hasFlag(F_MAY_ASYNC)) {
      let changed = false;
      for (let i = 0; i < nextValue.length; i++) {
        const child = nextValue[i]!;
        const result = child.preEval(context) as T;
        if (result !== child) {
          nextValue[i] = result;
          changed = true;
        }
      }
      if (changed) {
        setField(node, 'value', nextValue, context);
      }
      return node;
    }

    let changed = false;
    const out = serialForEach(nextValue, (child, i) => {
      const result = child.preEval(context);
      if (isThenable(result)) {
        return (result as Promise<T>).then((resolved) => {
          if (resolved !== child) {
            nextValue[i] = resolved;
            changed = true;
          }
        });
      }
      if (result !== child) {
        nextValue[i] = result as T;
        changed = true;
      }
    });
    if (isThenable(out)) {
      return (out as Promise<void>).then(() => {
        if (changed) {
          setField(node, 'value', nextValue, context);
        }
        return node;
      });
    }
    if (changed) {
      setField(node, 'value', nextValue, context);
    }
    return node;
  }

  protected override evalNode(context: Context): MaybePromise<Node> {
    const value = this.get('value', context);
    const nextValue = value.slice();

    if (!this.hasFlag(F_MAY_ASYNC)) {
      let changed = false;
      for (let i = 0; i < nextValue.length; i++) {
        const child = nextValue[i]!;
        const result = child.eval(context) as T;
        if (result !== child) {
          nextValue[i] = result;
          changed = true;
        }
      }
      if (changed) {
        setField(this, 'value', nextValue, context);
      }
      return this;
    }

    let changed = false;
    const out = serialForEach(nextValue, (child, i) => {
      const result = child.eval(context);
      if (isThenable(result)) {
        return (result as Promise<T>).then((resolved) => {
          if (resolved !== child) {
            nextValue[i] = resolved;
            changed = true;
          }
        });
      }
      if (result !== child) {
        nextValue[i] = result as T;
        changed = true;
      }
    });
    if (isThenable(out)) {
      return (out as Promise<void>).then(() => {
        if (changed) {
          setField(this, 'value', nextValue, context);
        }
        return this;
      });
    }
    if (changed) {
      setField(this, 'value', nextValue, context);
    }
    return this;
  }
}

type Params = ConstructorParameters<typeof List>;

export const list = defineType(List, 'List') as (
  value: Params[0],
  options?: Params[1],
  location?: Params[2],
  treeContext?: Params[3]
) => List;
