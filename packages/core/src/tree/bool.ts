import type { Context } from '../context.js';
import { Node, F_STATIC, F_VISIBLE, defineType, type LocationInfo, type NodeOptions } from './node.js';
import { type FinalPrintOptions, type PrintOptions, getPrintOptions } from './util/print.js';
import { isRenderBuffer, type RenderBuffer, writeRenderText } from './util/render-buffer.js';

export interface Bool extends Node<boolean> {
  eval(context: Context): Bool;
}

/**
 * A boolean. Named `Bool` to avoid conflict with the built-in `Boolean` class.
 */
export class Bool extends Node<boolean> {
  static override childKeys = null;

  constructor(
    value: boolean,
    options?: NodeOptions,
    location?: LocationInfo,
    treeContext?: Context['treeContext']
  ) {
    super(value, options, location, false);
    this._treeContext = treeContext;
    this.addFlag(F_STATIC);
  }

  override compare(other: Node): 0 | 1 | -1 | undefined {
    if (other instanceof Bool) {
      return this.value === other.value ? 0 : undefined;
    }
    return undefined;
  }

  override toTrimmedString(options?: PrintOptions) {
    const out = this.value ? 'true' : 'false';
    getPrintOptions(options).writer.add(out, this);
    return out;
  }

  /** @internal */
  override writeSyntax(options: FinalPrintOptions): void {
    options.writer.add(this.value ? 'true' : 'false', this);
  }

  override render(context: Context, buffer: RenderBuffer, options?: PrintOptions): string;
  override render(context: Context, options?: PrintOptions): string;
  override render(_context: Context, bufferOrOptions?: RenderBuffer | PrintOptions, _options?: PrintOptions): string {
    if (!this.hasFlag(F_VISIBLE) && !this.fullRender) {
      return '';
    }
    const out = this.value ? 'true' : 'false';
    if (isRenderBuffer(bufferOrOptions)) {
      return writeRenderText(bufferOrOptions, out);
    }
    getPrintOptions(bufferOrOptions).writer.add(out, this);
    return out;
  }

  override resolve(_context: Context): this {
    return this;
  }
}

export function createPublicBool(value: boolean): Bool {
  return new Bool(value);
}

export const bool = defineType(Bool, 'Bool');
