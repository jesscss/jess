import { defineType, type LocationInfo, type Node } from './node.js';
import { type TreeContext } from '../context.js';
import { SimpleSelector } from './selector-simple.js';
import { type PrintOptions, getPrintOptions } from './util/print.js';
import type { Context } from '../context.js';
import { Any } from './any.js';
import { quoted } from './quoted.js';
import { pipe, isThenable, type MaybePromise } from '@jesscss/awaitable-pipe';
import { isNode } from './util/is-node.js';
import { N } from './node-type.js';

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
  private withResolvedParts(name: string | Node, value: Node | undefined): this {
    const node = this.clone(false) as this;
    node.value = { ...this.value, name, value };
    return node;
  }

  private createResolvedValueNode(value: Node): this {
    const node = this.clone();
    node.value.value = quoted(String(value.valueOf()));
    return node;
  }

  private resolveAttributeValue(context: Context): MaybePromise<Node | undefined> {
    const { value } = this.value;
    if (value instanceof Any && typeof value.value === 'string') {
      const raw = value.value.trim();
      const m = raw.match(/^@\{([^}]+)\}$/);
      if (m) {
        const key = m[1]!;
        const rules = this.rulesParent;
        if (rules) {
          const found = rules.find('declaration', key, 'VarDeclaration');
          const decl = Array.isArray(found) ? found[0] : found;
          if (decl && isNode(decl, N.VarDeclaration)) {
            const out = decl.value.value.resolve(context);
            if (isThenable(out)) {
              return (out as Promise<Node>).then(evaluated => quoted(String(evaluated.valueOf())));
            }
            return quoted(String((out as Node).valueOf()));
          }
        }
      }
    }
    return value?.resolve(context);
  }

  private renderAttributeSyntax(options?: PrintOptions): string {
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

  override evalNode(context: Context): MaybePromise<this> {
    return pipe(
      () => super.evalNode(context),
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
              if (decl && isNode(decl, N.VarDeclaration)) {
                const out = decl.value.value.eval(context);
                if (isThenable(out)) {
                  return (out as Promise<Node>).then((evaluated) => {
                    return this.createResolvedValueNode(evaluated);
                  });
                }
                return this.createResolvedValueNode(out as Node);
              }
            }
          }
        }
        return this;
      }
    );
  }

  override resolve(context: Context): MaybePromise<this> {
    const currentName = this.value.name;
    const currentValue = this.value.value;
    const name = typeof currentName === 'string' ? currentName : currentName.resolve(context);
    const value = this.resolveAttributeValue(context);
    const finalize = (resolvedName: string | Node, resolvedValue: Node | undefined): this => {
      if (resolvedName === currentName && resolvedValue === currentValue) {
        return this;
      }
      return this.withResolvedParts(resolvedName, resolvedValue);
    };
    if (isThenable(name) || isThenable(value)) {
      return Promise.all([name, value]).then(([resolvedName, resolvedValue]) => {
        return finalize(resolvedName as string | Node, resolvedValue as Node | undefined);
      });
    }
    return finalize(name as string | Node, value as Node | undefined);
  }

  override toTrimmedString(options?: PrintOptions) {
    return this.renderAttributeSyntax(options);
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
