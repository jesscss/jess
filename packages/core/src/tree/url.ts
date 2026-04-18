import { Node, defineType } from './node.js';
import { type Quoted } from './quoted.js';
import { type Any } from './any.js';
import type { Context } from '../context.js';
import { getPrintOptions, type PrintOptions } from './util/print.js';
import { isNode } from './util/is-node.js';
import { N } from './node-type.js';

/**
 * e.g. url('foo.png')
 */
export class Url extends Node<Quoted | Any> {
  private renderUrlSyntax(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    w.add('url(');
    this.value.toString(options);
    w.add(')');
    return w.getSince(mark);
  }

  /**
   * @todo - enable URL rewriting
   */
  override valueOf(): string {
    const value = this.value;
    if (isNode(value, N.Quoted)) {
      const quotedValue = value.value;
      if (isNode(quotedValue)) {
        return String(quotedValue.value);
      }
      return quotedValue;
    }
    return value.value;
  }

  override render(context: Context, options?: PrintOptions): string;
  override render(options?: PrintOptions): string;
  override render(
    contextOrOptions?: Context | PrintOptions,
    maybeOptions?: PrintOptions
  ): string {
    const context = (
      contextOrOptions
      && typeof contextOrOptions === 'object'
      && 'opts' in contextOrOptions
    )
      ? contextOrOptions as Context
      : undefined;
    if (context) {
      return super.render(context, maybeOptions);
    }
    return this.renderUrlSyntax(contextOrOptions as PrintOptions | undefined);
  }

  override toTrimmedString(options?: PrintOptions) {
    return this.renderUrlSyntax(options);
  }
}

export const url = defineType(Url, 'Url');
