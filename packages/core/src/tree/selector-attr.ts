import { defineType, type LocationInfo, type Node } from './node.js';
import { SimpleSelector } from './selector-simple.js';
import { type PrintOptions, getPrintOptions, prepareRenderPrintState } from './util/print.js';
import type { Context } from '../context.js';
import { Any } from './any.js';
import { quoted } from './quoted.js';
import { isThenable, type MaybePromise } from '@jesscss/awaitable-pipe';
import { isNode } from './util/is-node.js';
import { N } from './node-type.js';
import { canReuseLeaf, copyWithReusableLeaves, reuseLeaf } from './util/cloning.js';
import {
  isRenderBuffer,
  prepareBufferPrintState,
  type RenderBuffer,
  writeRenderText
} from './util/render-buffer.js';
import type { Rules } from './rules.js';
import type { VarDeclaration } from './declaration-var.js';
import {
  DIRECT_DECLARATION_LOOKUP_UNCOVERED,
  findVariableDeclaration
} from './util/direct-rules-lookup.js';

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

function findAttributeVarDeclaration(rules: Rules, key: string): VarDeclaration | undefined {
  const direct = findVariableDeclaration(rules, key);
  const found = direct !== DIRECT_DECLARATION_LOOKUP_UNCOVERED
    ? direct
    : rules.findVariable(key);
  return isNode(found, N.VarDeclaration) ? found : undefined;
}

/**
 * An attribute selector
 * @see https://developer.mozilla.org/en-US/docs/Web/CSS/Attribute_selectors
 *   e.g. [id="foo"]
*/
export class AttributeSelector extends SimpleSelector<AttributeSelectorValue> {
  private createResolvedValueNode(value: Node): AttributeSelector {
    const node = new AttributeSelector(
      {
        name: this.value.name,
        op: this.value.op,
        value: quoted(String(value.valueOf())),
        mod: this.value.mod
      },
      this._options,
      this.location
    );
    node.inherit(this);
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
          const decl = findAttributeVarDeclaration(rules, key);
          if (decl) {
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

  private renderAttributeParts(
    name: string | Node,
    value: Node | undefined,
    options?: PrintOptions
  ): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    const { op, mod } = this.value;
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

  private renderAttributeSyntax(options?: PrintOptions): string {
    return this.renderAttributeParts(this.value.name, this.value.value, options);
  }

  override evalNode(context: Context): MaybePromise<Node> {
    const evaluated = super.evalNode(context);
    if (isThenable(evaluated)) {
      return evaluated.then(() => this.evaluateInterpolatedAttributeValue(context));
    }
    return this.evaluateInterpolatedAttributeValue(context);
  }

  private evaluateInterpolatedAttributeValue(context: Context): MaybePromise<Node> {
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
          const decl = findAttributeVarDeclaration(rules, key);
          if (decl) {
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

  protected override resolveForRender(context: Context): MaybePromise<AttributeSelector> {
    const currentName = this.value.name;
    const currentValue = this.value.value;
    const name = typeof currentName === 'string' ? currentName : currentName.resolve(context);
    const value = this.resolveAttributeValue(context);
    const finalize = (resolvedName: string | Node, resolvedValue: Node | undefined): AttributeSelector => {
      if (resolvedName === currentName && resolvedValue === currentValue) {
        return this;
      }
      const ownedName = typeof resolvedName === 'string'
        ? resolvedName
        : resolvedName === currentName
          ? canReuseLeaf(resolvedName) ? reuseLeaf(resolvedName) : copyWithReusableLeaves(resolvedName)
          : resolvedName;
      const ownedValue = resolvedValue && resolvedValue === currentValue
        ? canReuseLeaf(resolvedValue) ? reuseLeaf(resolvedValue) : copyWithReusableLeaves(resolvedValue)
        : resolvedValue;
      const node = new AttributeSelector(
        {
          name: ownedName,
          op: this.value.op,
          value: ownedValue,
          mod: this.value.mod
        },
        this._options,
        this.location
      );
      node.inherit(this);
      return node;
    };
    if (isThenable(name)) {
      return (name as Promise<string | Node>).then((resolvedName) => {
        if (isThenable(value)) {
          return (value as Promise<Node | undefined>).then((resolvedValue) => {
            return finalize(resolvedName, resolvedValue);
          });
        }
        return finalize(resolvedName, value as Node | undefined);
      });
    }
    if (isThenable(value)) {
      return (value as Promise<Node | undefined>).then((resolvedValue) => {
        return finalize(name as string | Node, resolvedValue);
      });
    }
    return finalize(name as string | Node, value as Node | undefined);
  }

  override resolve(context: Context): MaybePromise<this> {
    return this.resolveForRender(context);
  }

  override render(context: Context, buffer: RenderBuffer, options?: PrintOptions): MaybePromise<string>;
  override render(context: Context, options?: PrintOptions): string;
  override render(context: Context, bufferOrOptions?: RenderBuffer | PrintOptions, options?: PrintOptions): string | MaybePromise<string> {
    const buffer = isRenderBuffer(bufferOrOptions) ? bufferOrOptions : undefined;
    const printOptions = isRenderBuffer(bufferOrOptions) ? undefined : bufferOrOptions;
    const currentName = this.value.name;
    const name = typeof currentName === 'string' ? currentName : currentName.resolve(context);
    const value = this.resolveAttributeValue(context);
    const finalize = (resolvedName: string | Node, resolvedValue: Node | undefined): string => {
      const prepared = buffer
        ? prepareBufferPrintState(context, options)
        : prepareRenderPrintState(context, printOptions);
      const out = this.renderAttributeParts(resolvedName, resolvedValue, prepared);
      return buffer ? writeRenderText(buffer, out) : out;
    };
    if (isThenable(name)) {
      return (name as Promise<string | Node>).then((resolvedName) => {
        if (isThenable(value)) {
          return (value as Promise<Node | undefined>).then(resolvedValue => finalize(resolvedName, resolvedValue));
        }
        return finalize(resolvedName, value as Node | undefined);
      });
    }
    if (isThenable(value)) {
      return (value as Promise<Node | undefined>).then(resolvedValue => finalize(name as string | Node, resolvedValue));
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
  location?: LocationInfo | 0
) => AttributeSelector;
