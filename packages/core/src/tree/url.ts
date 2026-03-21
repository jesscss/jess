import { Node, defineType, type NodeOptions, type LocationInfo, type TreeContext } from './node.js';
import { type Quoted } from './quoted.js';
import { type Any } from './any.js';
import { getPrintOptions, type PrintOptions } from './util/print.js';
import { isNode } from './util/is-node.js';
import { N } from './node-type.js';
import type { Context } from '../context.js';
import { sessionGetField, sessionPatchField } from './util/session-helpers.js';
import { isThenable, type MaybePromise } from '@jesscss/awaitable-pipe';

/**
 * e.g. url('foo.png')
 */
export interface Url {
  type: 'Url';
  shortType: 'url';
}

export class Url extends Node<Quoted | Any> {
  static override childKeys = ['value'] as const;

  value!: Quoted | Any;

  constructor(value: Quoted | Any, options?: NodeOptions, location?: LocationInfo, treeContext?: TreeContext) {
    super(value as any, options, location, treeContext);
    this.value = value;
    if (value instanceof Node) {
      this.adopt(value);
    }
  }

  private _getValue(context?: Context): Quoted | Any {
    return context
      ? sessionGetField<Quoted | Any>(this, 'value', context)
      : this.value;
  }

  private _setValue(value: Quoted | Any, context: Context): void {
    if (value instanceof Node) {
      this.adopt(value, context);
    }
    if (context.session) {
      sessionPatchField(this, 'value', value, context);
    } else {
      this.setData('value', value);
    }
  }

  /**
   * @todo - enable URL rewriting
   */
  override valueOf(): string {
    let value: Node | string = this.value;
    if (isNode(value, N.Quoted)) {
      value = (value as any).value as Node | string;
      if (isNode(value)) {
        return String((value as any).value);
      }
      return value as string;
    }
    return (value as any).value;
  }

  override evalNode(context: Context): MaybePromise<Url> {
    const value = this._getValue(context);
    const finish = (nextValue: Quoted | Any): Url => {
      if (nextValue !== value) {
        this._setValue(nextValue, context);
      }
      return this;
    };
    const maybeEvald = value.eval(context) as MaybePromise<Quoted | Any>;
    if (isThenable(maybeEvald)) {
      return (maybeEvald as Promise<Quoted | Any>).then(finish);
    }
    return finish(maybeEvald as Quoted | Any);
  }

  override toTrimmedString(options?: PrintOptions) {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    const value = this._getValue(options.context);
    w.add('url(');
    value.toString(options);
    w.add(')');
    return w.getSince(mark);
  }
}

export const url = defineType(Url, 'Url');
