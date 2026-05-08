import { type Context } from '../context.js';
import { defineType, Node } from './node.js';
import { type PrintOptions, getPrintOptions } from './util/print.js';
import { compareNodeArray } from './util/compare.js';
import { type Operator } from './util/calculate.js';
import {
  consumeTrivia,
  emitCommentTriviaBetweenNodes,
  emitTriviaTokens
} from './util/trivia.js';
import { isThenable, type MaybePromise, serialForEach } from '@jesscss/awaitable-pipe';
import {
  isRenderBuffer,
  renderNodeToBuffer,
  type RenderBuffer
} from './util/render-buffer.js';

function emitListItem<T extends Node>(
  item: T,
  options: ReturnType<typeof getPrintOptions>,
  suppressPre = false
): void {
  const saved = options.suppressBoundaryTrivia;
  options.suppressBoundaryTrivia = suppressPre ? 'both' : 'post';
  try {
    item.toString(options);
  } finally {
    options.suppressBoundaryTrivia = saved;
  }
}

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
  private withResolvedValue(value: Node[]): List<Node> {
    return new List<Node>(
      value,
      this._options ? { ...this._options } : undefined
    ).inherit(this);
  }

  private renderListSyntax(options?: PrintOptions): string {
    const printOptions = getPrintOptions(options);
    const w = printOptions.writer;
    const sep = this._options?.sep ?? ',';
    let { value } = this;
    let length = value.length;
    const mark = w.mark();
    if (value.length === 0) {
      return '';
    }
    let item = value[0]!;
    emitListItem(item, printOptions);
    for (let i = 1; i < length; i++) {
      const prev = item;
      item = value[i]!;
      emitCommentTriviaBetweenNodes(prev, item, printOptions);
      const leadingTrivia = printOptions.trivia
        ? consumeTrivia(printOptions.trivia, item.location[0], 'before', printOptions)
        : undefined;
      const leadingWhitespace = leadingTrivia?.[0]?.tokenType.name === 'WS'
        ? leadingTrivia[0].image
        : '';
      const preserveLeadingWhitespace = /[\r\n]/.test(leadingWhitespace);
      if (sep === '/') {
        w.add(preserveLeadingWhitespace ? ' /' : ' / ');
      } else {
        w.add(preserveLeadingWhitespace ? sep : `${sep} `);
      }
      if (leadingTrivia) {
        emitTriviaTokens(
          leadingTrivia,
          printOptions,
          { skipLeadingWhitespace: !preserveLeadingWhitespace }
        );
      }
      emitListItem(item, printOptions, true);
    }
    return w.getSince(mark);
  }

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
    return this.renderListSyntax(options);
  }

  override render(context: Context, buffer: RenderBuffer, options?: PrintOptions): MaybePromise<string>;
  override render(context: Context, options?: PrintOptions): string;
  override render(context: Context, bufferOrOptions?: RenderBuffer | PrintOptions, options?: PrintOptions): string | MaybePromise<string> {
    if (isRenderBuffer(bufferOrOptions)) {
      return renderNodeToBuffer(this, context, bufferOrOptions, options);
    }
    return super.render(context, bufferOrOptions);
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

  override resolve(context: Context): MaybePromise<Node> {
    const values = new Array<Node>(this.value.length);
    const maybe = serialForEach(this.value.map((item, index) => [item, index] as const), ([item, index]) => {
      const out = item.resolve(context);
      if (isThenable(out)) {
        return (out as Promise<Node>).then((resolved) => {
          values[index] = resolved;
        });
      }
      values[index] = out as Node;
    });

    const finalize = (): Node => {
      const unchanged = values.every((node, index) => node === this.value[index]);
      return unchanged ? this : this.withResolvedValue(values);
    };

    if (isThenable(maybe)) {
      return (maybe as Promise<void>).then(finalize);
    }
    return finalize();
  }

  /** @todo? Lists should collapse nested lists? */
  // override async evalNode(context: Context): Promise<List<T>>

  /** @todo move to ToCssVisitor */
  // toCSS(context: Context, out: OutputCollector) {
  //   out.add('', this.location)
  //   const length = this.value.length - 1
  //   const cast = context.cast
  //   this.value.forEach((node, i) => {
  //     const val = cast(node)
  //     val.toCSS(context, out)

  //     if (i < length) {
  //       if (context.inSelector) {
  //         out.add(`,\n`)
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
  //   out.add(`\n])`)
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
