import { Node, defineType } from './node.js';
import { type Quoted } from './quoted.js';
import { type Any } from './any.js';
import type { Context } from '../context.js';
import { getPrintOptions, type PrintOptions } from './util/print.js';
import { isNode } from './util/is-node.js';
import { N } from './node-type.js';
import type { MaybePromise } from '@jesscss/awaitable-pipe';

/**
 * e.g. url('foo.png')
 */
export class Url extends Node<Quoted | Any> {
  private renderUrlSyntax(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    w.add('url(');
    if (options.context) {
      const valueOut = w.capture(() => this.value.toString(options))
        .replace(/^[ \t\r\n\f]+|[ \t\r\n\f]+$/g, '')
        .replace(/\n[ \t\r\f]+/g, '\n  ');
      w.add(valueOut, this.value);
    } else {
      this.value.toString(options);
    }
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

  override toTrimmedString(options?: PrintOptions) {
    return this.renderUrlSyntax(options);
  }

  override resolve(context: Context): MaybePromise<Node> {
    return this.evalNode(context);
  }
}

export const url = defineType(Url, 'Url');
