import { type Context } from '../context.js';
import { defineType, Node } from './node.js';
import { type PrintOptions, getPrintOptions } from './util/print.js';
import { compareNodeArray } from './util/compare.js';
import { type Operator } from './util/calculate.js';
import { LIST_ITEM_TRIM } from './util/regex.js';

export type ListOptions = {
  /**
   * Lists can be separated by comma, semi-colon,
   * or slash, depending on the type of list.
   *
   * @todo - Is there a more CSS-y way to define this?
   */
  sep?: ',' | ';' | '/';
};

export interface List<T extends Node = Node> extends Node<T[], ListOptions> {
  eval(context: Context): Promise<this>;
}

/**
 * A list of expressions
 *
 * i.e. one, two, three
 * or .sel, #id.class, [attr]
 * or one / two / three
 */
export class List<T extends Node = Node> extends Node<T[], ListOptions> {
  get length() {
    return this.value.length;
  }

  * [Symbol.iterator]() {
    yield* this.value.entries();
  }

  private _valueOf: string | undefined;

  override valueOf() {
    return (this._valueOf ??= this.value.map(v => v.valueOf()).join(';'));
  }

  override toTrimmedString(options?: PrintOptions) {
    options = getPrintOptions(options);
    const w = options.writer!;
    let { sep = ',' } = this.options ?? {};
    let { value } = this;
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
    if (other instanceof List) {
      const equalityMode = this.treeContext?.equalityMode ?? 'coerce';
      const result = compareNodeArray(this.value, other.value, equalityMode);
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

  override operate(b: Node, op: Operator, _context: Context): List<Node> {
    if (op !== '+') {
      throw new Error(`List operation "${op}" not supported`);
    }
    const newList = new List<Node>([...this.value], this._options ? { ...this._options } : undefined);
    newList.inherit(this);
    if (b instanceof List) {
      newList.value.push(...b.value);
    } else {
      newList.value.push(b);
    }
    return newList;
  }

  /** @todo? Lists should collapse nested lists? */
  // override async evalNode(context: Context): Promise<List<T>>

  /** @todo move to ToCssVisitor */
  // toCSS(context: Context, out: OutputCollector) {
  //   out.add('', this.location)
  //   const length = this.value.length - 1
  //   const pre = context.pre
  //   const cast = context.cast
  //   this.value.forEach((node, i) => {
  //     const val = cast(node)
  //     val.toCSS(context, out)

  //     if (i < length) {
  //       if (context.inSelector) {
  //         out.add(`,\n${pre}`)
  //       } else {
  //         out.add(', ')
  //       }
  //     }
  //   })
  // }

  /** @todo move to ToModuleVisitor */
  // toModule(context: Context, out: OutputCollector) {
  //   out.add('$J.list([\n', this.location)
  //   context.indent++
  //   let pre = context.pre
  //   const length = this.value.length - 1
  //   this.value.forEach((node, i) => {
  //     out.add(pre)
  //     if (node instanceof Node) {
  //       node.toModule(context, out)
  //     } else {
  //       out.add(JSON.stringify(node))
  //     }
  //     if (i < length) {
  //       out.add(',\n')
  //     }
  //   })
  //   context.indent--
  //   pre = context.pre
  //   out.add(`\n${pre}])`)
  //   return out
  // }
}

type Params = ConstructorParameters<typeof List>;

export const list = defineType(List, 'List') as (
  value: Params[0],
  options?: Params[1],
  location?: Params[2],
  treeContext?: Params[3]
) => List;
