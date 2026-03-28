import { Node, defineType, type NodeOptions, type OptionalLocation, type TreeContext } from './node.js';
import { type Quoted } from './quoted.js';
import { type Any } from './any.js';
import { getPrintOptions, type PrintOptions } from './util/print.js';
import { isNode } from './util/is-node.js';
import { N } from './node-type.js';
import type { Context } from '../context.js';
import { getField, setField } from './util/field-helpers.js';
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

  readonly value!: Quoted | Any;

  constructor(value: Quoted | Any, options?: NodeOptions, location?: OptionalLocation, treeContext?: TreeContext) {
    super(value as any, options, location, treeContext);
    this.value = value;
    if (value instanceof Node) {
      this.adopt(value);
    }
  }

  private _getValue(context?: Context): Quoted | Any {
    return context
      ? getField<Quoted | Any>(this, 'value', context)
      : this.value;
  }

  /**
   * @todo - enable URL rewriting
   */
  // NOTE: `valueOf()` intentionally remains canonical for now. Import-path
  // consumers currently call it without a Context channel, so a state-aware
  // answer would require either plumbing Context into that observer or changing
  // the eval contract to return a materialized Url value for those callers.
  override valueOf(): string {
    return this.pathValue();
  }

  pathValue(context?: Context): string {
    let value: Node | string = this.value;
    if (context) {
      value = this._getValue(context);
    }
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
        setField(this, 'value', nextValue, context);
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
