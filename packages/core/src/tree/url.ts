import { Node, defineType } from './node.js';
import { type Quoted } from './quoted.js';
import { type Any } from './any.js';
import { getPrintOptions, type PrintOptions } from './util/print.js';
import { isNode } from './util/is-node.js';
import { N } from './node-type.js';

/**
 * e.g. url('foo.png')
 */
export interface Url {
  type: 'Url';
  shortType: 'url';
}

export class Url extends Node<Quoted | Any> {
  /**
   * @todo - enable URL rewriting
   */
  override valueOf(): string {
    let value: Node | string = this.value;
    if (isNode(value, N.Quoted)) {
      value = value.value;
      if (isNode(value)) {
        return String(value.value);
      }
      return value;
    }
    return (value as Any).value;
  }

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