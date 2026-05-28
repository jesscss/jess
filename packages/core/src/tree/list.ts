import { type Context } from '../context.js';
import { defineType, F_STATIC, Node } from './node.js';
import { type PrintOptions, getPrintOptions, prepareRenderPrintState } from './util/print.js';
import { compareNodeArray } from './util/compare.js';
import { type Operator } from './util/calculate.js';
import {
  consumeTrivia,
  emitCommentTriviaBetweenNodes,
  emitTriviaTokens
} from './util/trivia.js';
import { isThenable, pipe, type MaybePromise, serialForEach } from '@jesscss/awaitable-pipe';
import {
  isRenderBuffer,
  prepareBufferPrintState,
  writeRenderText,
  type RenderBuffer
} from './util/render-buffer.js';
import { copyWithReusableLeaves } from './util/cloning.js';

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

export function renderListValueSyntax<T extends Node>(
  value: T[],
  options: PrintOptions,
  sep: ListOptions['sep'] = ','
): string {
  const printOptions = getPrintOptions(options);
  const w = printOptions.writer;
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

  private deriveAdditionList(): List<Node> {
    return new List<Node>(
      this.value.map(value => copyWithReusableLeaves(value)),
      this._options ? { ...this._options } : undefined,
      this.location.length ? this.location : undefined,
      this.treeContext
    ).inherit(this);
  }

  private renderListSyntax(value = this.value, options?: PrintOptions): string {
    return renderListValueSyntax(value, getPrintOptions(options), this._options?.sep ?? ',');
  }

  private resolveItems(context: Context): MaybePromise<Node[]> {
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
    if (isThenable(maybe)) {
      return (maybe as Promise<void>).then(() => values);
    }
    return values;
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
    return this.renderListSyntax(this.value, options);
  }

  override render(context: Context, buffer: RenderBuffer, options?: PrintOptions): MaybePromise<string>;
  override render(context: Context, options?: PrintOptions): string;
  override render(context: Context, bufferOrOptions?: RenderBuffer | PrintOptions, options?: PrintOptions): string | MaybePromise<string> {
    return pipe(
      () => this.resolveValue(context),
      node => this.renderResolvedList(context, node, bufferOrOptions, options)
    );
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
    const newList = this.deriveAdditionList();
    if (b instanceof List) {
      newList.value.push(...b.value.map(value => copyWithReusableLeaves(value)));
    } else {
      newList.value.push(copyWithReusableLeaves(b));
    }
    return newList;
  }

  override resolve(context: Context): MaybePromise<Node> {
    return this.resolveValue(context);
  }

  private renderResolvedList(
    context: Context,
    node: List<Node>,
    bufferOrOptions?: RenderBuffer | PrintOptions,
    options?: PrintOptions
  ): string {
    const buffer = isRenderBuffer(bufferOrOptions) ? bufferOrOptions : undefined;
    const prepared = buffer
      ? prepareBufferPrintState(context, options)
      : prepareRenderPrintState(context, bufferOrOptions);
    const out = node.renderListSyntax(node.value, prepared);
    return buffer
      ? writeRenderText(buffer, out)
      : out;
  }

  private resolveValue(context: Context): MaybePromise<List<Node>> {
    if (this.hasFlag(F_STATIC)) {
      return this;
    }
    const values = this.resolveItems(context);
    if (isThenable(values)) {
      return (values as Promise<Node[]>).then((resolvedValues) => {
        const unchanged = resolvedValues.every((node, index) => node === this.value[index]);
        return unchanged ? this : this.withResolvedValue(resolvedValues);
      });
    }
    const unchanged = values.every((node, index) => node === this.value[index]);
    return unchanged ? this : this.withResolvedValue(values);
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
