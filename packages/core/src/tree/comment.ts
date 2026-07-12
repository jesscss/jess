import { type Context } from '../context.js';
import { Node, F_VISIBLE, F_STATIC, defineType, type LocationInfo } from './node.js';
import { type FinalPrintOptions, getPrintOptions, type PrintOptions } from './util/print.js';
import { isRenderBuffer, type RenderBuffer, writeRenderText } from './util/render-buffer.js';

export type CommentOptions = {
  lineComment?: boolean;
};

export interface Comment extends Node<string, CommentOptions> {
  eval(context: Context): Comment;
}

// AUDIT: Probably don't need this unless a parent is visited.
/**
 * A comment node
 */
export class Comment extends Node<string, CommentOptions> {
  static override childKeys = null;

  declare readonly value: string;

  override allowRoot = true;
  override allowRuleRoot = true;
  readonly lineComment: boolean;

  constructor(value: string, options?: CommentOptions, location?: LocationInfo, treeContext?: Context['treeContext']) {
    super(value, options, location);
    this._treeContext = treeContext;
    this.lineComment = options?.lineComment === true || value.startsWith('//');
    this.addFlag(F_STATIC);
    if (this.lineComment) {
      this.removeFlag(F_VISIBLE);
    }
  }

  override resolve(_context: Context): this {
    return this;
  }

  override toTrimmedString(options?: PrintOptions): string {
    const out = this.value;
    getPrintOptions(options).writer.add(out, this);
    return out;
  }

  /** @internal */
  override writeSyntax(options: FinalPrintOptions): void {
    options.writer.add(this.value, this);
  }

  override render(context: Context, buffer: RenderBuffer, options?: PrintOptions): string;
  override render(context: Context, options?: PrintOptions): string;
  override render(_context: Context, bufferOrOptions?: RenderBuffer | PrintOptions, _options?: PrintOptions): string {
    if (!this.hasFlag(F_VISIBLE) && !this.fullRender) {
      return '';
    }
    const out = this.value;
    if (isRenderBuffer(bufferOrOptions)) {
      return writeRenderText(bufferOrOptions, out);
    }
    getPrintOptions(bufferOrOptions).writer.add(out, this);
    return out;
  }
}
export const comment = defineType(Comment, 'Comment');
