import { defineType, type LocationInfo, type Node } from './node.js';
import { type TreeContext } from '../context.js';
import { SimpleSelector } from './selector-simple.js';
import { compare } from './util/compare.js';
import { type PrintOptions, getPrintOptions } from './util/print.js';
import type { Context } from '../context.js';
import { Any } from './any.js';
import { quoted } from './quoted.js';
import { pipe, isThenable, type MaybePromise } from '@jesscss/awaitable-pipe';
import { isNode } from './util/is-node.js';

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
export class AttributeSelector extends SimpleSelector<AttributeSelectorValue> {
  type = 'AttributeSelector' as const;
  shortType = 'attr' as const;

  override evalNode(context: Context): MaybePromise<this> {
    return pipe(
      () => super.evalNode(context) as any,
      () => {
        const { value } = this.value;
        // Handle Less interpolation that the parser may have left as a raw token in selectors:
        //   [data=@{attr-data}]
        // In Less semantics this should resolve to the variable value and be serialized quoted.
        if (value instanceof Any && typeof value.value === 'string') {
          const raw = value.value.trim();
          const m = raw.match(/^@\{([^}]+)\}$/);
          if (m) {
            const key = m[1]!;
            const rules = this.rulesParent;
            if (rules) {
              const found = rules.find('declaration', key, 'VarDeclaration');
              const decl = Array.isArray(found) ? found[0] : found;
              if (decl && isNode(decl, 'VarDeclaration')) {
                const out = decl.value.value.eval(context);
                if (isThenable(out)) {
                  return (out as Promise<Node>).then((evaluated) => {
                    this.value.value = quoted(String(evaluated.valueOf()));
                    this._valueOf = undefined;
                    this._keySet = undefined;
                    this._visibleKeySet = undefined;
                    this._canFastReject = undefined;
                    return this;
                  });
                }
                this.value.value = quoted(String((out as Node).valueOf()));
                this._valueOf = undefined;
                this._keySet = undefined;
                this._visibleKeySet = undefined;
                this._canFastReject = undefined;
              }
            }
          }
        }
        return this;
      }
    );
  }

  override toTrimmedString(options?: PrintOptions) {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    const { name, op, value, mod } = this.value;
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
      let { name, op, value, mod } = this.value;
      /** Attributes are case-insensitive */
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
  location?: LocationInfo | 0,
  treeContext?: TreeContext
) => AttributeSelector;