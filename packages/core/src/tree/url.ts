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
  get value() {
    return this.data as Quoted | Any;
  }

  set value(val: Quoted | Any) {
    this.setData(val);
  }

  /**
   * @todo - enable URL rewriting
   */
  override valueOf(): string {
    let value: Node | string = this.data as Quoted | Any;
    if (isNode(value, N.Quoted)) {
      value = value.data as Node | string;
      if (isNode(value)) {
        return String(value.data);
      }
      return value as string;
    }
    return (value as Any).data;
  }

  override toTrimmedString(options?: PrintOptions) {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    w.add('url(');
    this.data.toString(options);
    w.add(')');
    return w.getSince(mark);
  }
}

export const url = defineType(Url, 'Url');