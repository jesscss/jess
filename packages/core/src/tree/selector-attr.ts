import { defineType, type OptionalLocation, Node, type NodeOptions } from './node.js';
import { type TreeContext } from '../context.js';
import { SimpleSelector } from './selector-simple.js';
import { type PrintOptions, getPrintOptions } from './util/print.js';
import type { Context } from '../context.js';
import { isThenable, type MaybePromise } from '@jesscss/awaitable-pipe';
import { setField } from './util/field-helpers.js';

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

export type AttributeSelectorChildData = {
  name: string | Node;
  op: string | undefined;
  value: Node | undefined;
  mod: string | undefined;
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

export class AttributeSelector extends SimpleSelector<AttributeSelectorValue, NodeOptions, AttributeSelectorChildData> {
  static override childKeys = ['name', 'value'] as const;

  /** @internal */ _name!: string | Node;
  private op: string | undefined;
  /** @internal */ _value: Node | undefined;
  private mod: string | undefined;

  override clone(deep?: boolean): this {
    const newNode = new (this.constructor as any)(
      {
        name: deep && this._name instanceof Node ? this._name.clone(deep) : this._name,
        op: this.op,
        value: deep && this._value instanceof Node ? this._value.clone(deep) : this._value,
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
    this._name = data.name;
    this.op = data.op;
    this._value = data.value;
    this.mod = data.mod;
    if (this._name instanceof Node) {
      this.adopt(this._name as Node);
    }
    if (this._value instanceof Node) {
      this.adopt(this._value);
    }
  }

  override evalNode(context: Context): MaybePromise<this> {
    const currentName = this.get('name', context);
    const currentValue = this.get('value', context);
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
    const name = this.get('name', context);
    const value = this.get('value', context);
    const op = this.get('op');
    const mod = this.get('mod');
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
      let name = this._name;
      let op = this.op;
      let value = this._value;
      let mod = this.mod;
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
