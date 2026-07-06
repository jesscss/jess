import { type Context } from '../context.js';
import { Node, defineType, type LocationInfo } from './node.js';
import { Selector } from './selector.js';
import { type FinalPrintOptions, type PrintOptions, getPrintOptions } from './util/print.js';
import { type MaybePromise, isThenable } from '@jesscss/awaitable-pipe';
import {
  isRenderBuffer,
  type RenderBuffer
} from './util/render-buffer.js';

export interface Apply extends Node<Selector[]> {
  eval(context: Context): MaybePromise<Apply>;
}

/**
 * Jess `$apply <selector-list>` — applies (calls) the listed rulesets as mixins.
 * Kept first-class in the AST (round-trips `$apply .a, .b;` structurally) instead
 * of being lowered to mixin calls.
 *
 * @todo eval semantics (expand to the applied rules) are TBD — this node is
 * currently structural / parse-only (see NOTES).
 */
export class Apply extends Node<Selector[]> {
  static override childKeys = ['selectors'] as const;

  readonly selectors: Selector[];

  constructor(value: Selector[], options?: undefined, location?: LocationInfo, treeContext?: Context['treeContext']) {
    super(value, options, location);
    this._treeContext = treeContext;
    this.selectors = value;
  }

  /** @internal */
  override writeSyntax(options: FinalPrintOptions): void {
    const w = options.writer;
    w.add('$apply ', this);
    // Comma-space separated on one line (`$apply .a, .b;`) — NOT the `,\n` list
    // emission the CSS selector-list serializer uses.
    this.selectors.forEach((selector, i) => {
      if (i > 0) {
        w.add(', ');
      }
      selector.writeSyntax(options);
    });
    w.add(';', this);
  }

  override valueOf(): string {
    return `$apply ${this.selectors.map(s => String(s.valueOf())).join(', ')}`;
  }

  override toTrimmedString(rawOptions?: PrintOptions): string {
    const options = getPrintOptions(rawOptions);
    const mark = options.writer.mark();
    this.writeSyntax(options);
    const w = options.writer;
    return w.getSince(mark);
  }

  override render(context: Context, buffer: RenderBuffer, options?: PrintOptions): MaybePromise<string>;
  override render(context: Context, options?: PrintOptions): string;
  override render(context: Context, bufferOrOptions?: RenderBuffer | PrintOptions, options?: PrintOptions): string | MaybePromise<string> {
    // Structural / parse-only: render the authored surface (`$apply …;`). Eval-time
    // expansion into the applied rules is TBD (see class @todo).
    const printOptions = isRenderBuffer(bufferOrOptions) ? options : bufferOrOptions;
    return this.toTrimmedString(printOptions);
  }

  override evalNode(context: Context): MaybePromise<Apply> {
    // Minimal, non-crashing placeholder: eval each target selector and return the
    // node structurally. Expanding `$apply` into the applied rules is out of scope
    // for this "small" node (see class @todo).
    const evaluated = this.selectors.map(s => s.eval(context));
    if (evaluated.some(isThenable)) {
      return Promise.all(evaluated).then(() => this);
    }
    return this;
  }
}

export const apply = defineType(Apply, 'Apply', 'apply');
