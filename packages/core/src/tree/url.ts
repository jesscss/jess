import { Node, defineType } from './node';
import { type Quoted } from './quoted';
import { type Any } from './any';
import { getPrintOptions, type PrintOptions } from './util/print';

/**
 * e.g. url('foo.png')
 */
export class Url extends Node<Quoted | Any> {
  type = 'Url';
  shortType = 'url';
  /**
   * @todo - enable URL rewriting
   */

  override toTrimmedString(options?: PrintOptions) {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    w.add('url(');
    this.value.toString(options);
    w.add(')');
    return w.getSince(mark);
  }
}

export const url = defineType(Url, 'Url');