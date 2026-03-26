import { defineType, type OptionalLocation, Node } from './node.js';
import { type TreeContext } from '../context.js';
import { SimpleSelector } from './selector-simple.js';
import { type PrintOptions, getPrintOptions } from './util/print.js';
import type { Context } from '../context.js';
import { isThenable, type MaybePromise } from '@jesscss/awaitable-pipe';
import { getField, setField } from './util/session-helpers.js';

export type AttributeSelectorValue = {
  /** The name of the attribute */
  name: string | Node;
  /** The operator */
  op?: string;
  /** The value of the attribute */
  value?: Node;
  /** The modifier (case insensitivity) */
  mod?: string;
};

/**
 * An attribute selector
 * @see https://developer.mozilla.org/en-US/docs/Web/CSS/Attribute_selectors
 *   e.g. [id="foo"]
*/
export interface AttributeSelector {
  type: 'AttributeSelector';
  shortType: 'attr';
}

export class AttributeSelector extends SimpleSelector<AttributeSelectorValue> {
  static override childKeys = ['name', 'value'] as const;

  name!: string | Node;
  op: string | undefined;
  value: Node | undefined;
  mod: string | undefined;

  override clone(deep?: boolean): this {
    const newNode = new (this.constructor as any)(
      {
        name: deep && this.name instanceof Node ? this.name.clone(deep) : this.name,
        op: this.op,
        value: deep && this.value instanceof Node ? this.value.clone(deep) : this.value,
        mod: this.mod
      },
      undefined,
      this.location,
      this.treeContext
    );
    newNode.inherit(this);
    return newNode;
  }

  constructor(data: AttributeSelectorValue, options?: undefined, location?: OptionalLocation, treeContext?: TreeContext) {
    super(data as any, options, location, treeContext);
    this.name = data.name;
    this.op = data.op;
    this.value = data.value;
    this.mod = data.mod;
    if (this.name instanceof Node) {
      this.adopt(this.name as Node);
    }
    if (this.value instanceof Node) {
      this.adopt(this.value);
    }
  }

  private _getName(context?: Context): string | Node {
    return context
      ? getField<string | Node>(this, 'name', context)
      : this.name;
  }

  private _getValue(context?: Context): Node | undefined {
    return context
      ? getField<Node | undefined>(this, 'value', context)
      : this.value;
  }

  override evalNode(context: Context): MaybePromise<this> {
    const currentName = this._getName(context);
    const currentValue = this._getValue(context);
    const maybeName = typeof currentName === 'string'
      ? currentName
      : currentName.eval(context);
    const maybeValue = currentValue?.eval(context);
    const finish = (name: string | Node, value: Node | undefined): this => {
      const node = this.maybeClone(context);

      if (name !== currentName) {
        setField(node, 'name', name, context);
      }
      if (value !== currentValue) {
        setField(node, 'value', value, context);
      }

      return node;
    };

    if (isThenable(maybeName) || isThenable(maybeValue)) {
      return Promise.all([
        Promise.resolve(maybeName),
        Promise.resolve(maybeValue)
      ]).then(([name, value]) => finish(name, value));
    }

    return finish(maybeName as string | Node, maybeValue as Node | undefined);
  }

  override toTrimmedString(options?: PrintOptions) {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    const context = options.context;
    const name = this._getName(context);
    const value = this._getValue(context);
    const { op, mod } = this;
    w.add('[');
    if (typeof name === 'string') {
      w.add(name, this);
    } else {
      name.toString(options);
    }
    if (op) {
      w.add(op);
    }
    if (value) {
      value.toString(options);
    }
    if (mod) {
      w.add(' ');
      w.add(mod);
    }
    w.add(']');
    return w.getSince(mark);
  }

  override valueOf() {
    let valueOf = this._valueOf;
    if (!valueOf) {
      let { name, op, value, mod } = this;
      let keyStr = (typeof name === 'string' ? name : name.toTrimmedString()).toLowerCase();
      if (!op) {
        return `[${keyStr}]`;
      }
      let valueStr = value?.valueOf() ?? '';
      valueOf = this._valueOf = `[${keyStr}${op}"${valueStr}"${mod ? ` ${mod}` : ''}]`;
    }
    return valueOf;
  }
}

/** Not sure why types couldn't be properly inferred */
export const attr = defineType<AttributeSelectorValue>(AttributeSelector, 'AttributeSelector', 'attr') as (
  value: AttributeSelectorValue,
  options?: undefined,
  location?: OptionalLocation | 0,
  treeContext?: TreeContext
) => AttributeSelector;
