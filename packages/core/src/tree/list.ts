import { type Context } from '../context.js';
import { CANONICAL, defineType, F_MAY_ASYNC, Node, type NodeEdge, type RenderKey } from './node.js';
import { type PrintOptions, getPrintOptions } from './util/print.js';
import { compareNodeArray } from './util/compare.js';
import { type Operator } from './util/calculate.js';
import { LIST_ITEM_TRIM } from './util/regex.js';
import { addEdgeAt, addParentEdge, removeParentEdge } from './util/cursor.js';
import { isThenable, serialForEach, type MaybePromise } from '@jesscss/awaitable-pipe';
import { canReuseEvalState } from './node-base.js';

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

export function getListItem<T extends Node | NodeEdge<Node>>(list: T[], index: number, renderKey?: RenderKey) {
  if (renderKey === undefined) {
    return list[index];
  }
  return list instanceof Map
    ? list.get(renderKey)?.[index] ?? list[index]
    : list[index];
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

  value: T[];
  valueEdges?: Array<NodeEdge<T> | undefined>;

  getValue(renderKey?: RenderKey) {
    if (renderKey === undefined || !this.valueEdges) {
      return this.value;
    }
    let resolved: T[] | undefined;
    for (let i = 0; i < this.value.length; i++) {
      const alternate = this.valueEdges[i]?.get(renderKey);
      if (alternate !== undefined) {
        (resolved ??= [...this.value])[i] = alternate;
      }
    }
    return resolved ?? this.value;
  }

  getValueAt(index: number, renderKey?: RenderKey) {
    return renderKey !== undefined
      ? this.valueEdges?.[index]?.get(renderKey) ?? this.value[index]
      : this.value[index];
  }

  at(index: number, context?: Context) {
    const renderKey = context?.renderKey ?? this.renderKey;
    return this.getValueAt(index, renderKey);
  }

  private _replaceValueAt(index: number, node: T, renderKey: RenderKey): void {
    const previous = this.getValueAt(index, renderKey);
    if (previous === node) {
      return;
    }
    if (previous && previous !== node) {
      removeParentEdge(previous, renderKey);
    }
    addEdgeAt(this, 'value', index, renderKey, node);
    addParentEdge(node, renderKey, this);
  }

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

  override toTrimmedString(options?: PrintOptions, renderKey?: RenderKey) {
    options = getPrintOptions(options);
    const w = options.writer!;
    let { sep = ',' } = this.options ?? {};
    const activeRenderKey = renderKey ?? options.context?.renderKey ?? this.renderKey;
    let value = this.getValue(activeRenderKey);
    let length = value.length;
    const mark = w.mark();
    if (value.length === 0) {
      return '';
    }
    // Print first item as-is
    let item = getListItem(value, 0, renderKey);
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
    const ownItems = this.getValue(context.renderKey);
    const nextItems = b instanceof List ? b.getValue(context.renderKey) : [b as T];
    let newList = this.clone();
    const nextValue = [...ownItems, ...nextItems];
    newList.value = nextValue;

    return newList;
  }

  override preEval(context: Context): MaybePromise<Node> {
    const reusableState = canReuseEvalState(this, context);
    if (this.preEvaluated && reusableState) {
      return this;
    }
    const renderKey = context.renderKey ?? this.renderKey;
    const isNonCanonical = renderKey !== undefined && renderKey !== CANONICAL;
    const value = this.getValue(renderKey);
    const nextValue = value.slice();

    if (!this.hasFlag(F_MAY_ASYNC)) {
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
        if (isNonCanonical) {
          for (let i = 0; i < nextValue.length; i++) {
            const child = nextValue[i]!;
            if (child !== value[i]) {
              this._replaceValueAt(i, child, renderKey);
            }
          }
          if (reusableState) {
            this.preEvaluated = true;
          }
          return this;
        } else {
          const node = this.clone();
          node.preEvaluated = true;
          node.value = nextValue;
          for (const child of nextValue) {
            node.adopt(child);
          }
          return node;
        }
      }
      if (reusableState) {
        this.preEvaluated = true;
      }
      return this;
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
          if (isNonCanonical) {
            for (let i = 0; i < nextValue.length; i++) {
              const child = nextValue[i]!;
              if (child !== value[i]) {
                this._replaceValueAt(i, child, renderKey);
              }
            }
            if (reusableState) {
              this.preEvaluated = true;
            }
            return this;
          } else {
            const node = this.clone();
            node.preEvaluated = true;
            node.value = nextValue;
            for (const child of nextValue) {
              node.adopt(child);
            }
            return node;
          }
        }
        if (reusableState) {
          this.preEvaluated = true;
        }
        return this;
      });
    }
    if (changed) {
      if (isNonCanonical) {
        for (let i = 0; i < nextValue.length; i++) {
          const child = nextValue[i]!;
          if (child !== value[i]) {
            this._replaceValueAt(i, child, renderKey);
          }
        }
        if (reusableState) {
          this.preEvaluated = true;
        }
        return this;
      } else {
        const node = this.clone();
        node.preEvaluated = true;
        node.value = nextValue;
        for (const child of nextValue) {
          node.adopt(child);
        }
        return node;
      }
    }
    if (reusableState) {
      this.preEvaluated = true;
    }
    return this;
  }

  protected override evalNode(context: Context): MaybePromise<Node> {
    const renderKey = context.renderKey ?? this.renderKey;
    const isNonCanonical = renderKey !== undefined && renderKey !== CANONICAL;
    const value = this.getValue(renderKey);
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
        if (isNonCanonical) {
          for (let i = 0; i < nextValue.length; i++) {
            const child = nextValue[i]!;
            if (child !== value[i]) {
              this._replaceValueAt(i, child, renderKey);
            }
          }
          return this;
        }
        const node = this.clone();
        node.value = nextValue;
        for (const child of nextValue) {
          node.adopt(child);
        }
        return node;
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
          if (isNonCanonical) {
            for (let i = 0; i < nextValue.length; i++) {
              const child = nextValue[i]!;
              if (child !== value[i]) {
                this._replaceValueAt(i, child, renderKey);
              }
            }
            return this;
          }
          const node = this.clone();
          node.value = nextValue;
          for (const child of nextValue) {
            node.adopt(child);
          }
          return node;
        }
        return this;
      });
    }
    if (changed) {
      if (isNonCanonical) {
        for (let i = 0; i < nextValue.length; i++) {
          const child = nextValue[i]!;
          if (child !== value[i]) {
            this._replaceValueAt(i, child, renderKey);
          }
        }
        return this;
      }
      const node = this.clone();
      node.value = nextValue;
      for (const child of nextValue) {
        node.adopt(child);
      }
      return node;
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
