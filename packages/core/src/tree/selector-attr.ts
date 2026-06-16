import { defineType, type LocationInfo, type Node } from './node.js';
import { SimpleSelector } from './selector-simple.js';
import { type FinalPrintOptions, type PrintOptions, getPrintOptions, prepareRenderPrintState } from './util/print.js';
import type { Context } from '../context.js';
import { Any } from './any.js';
import { Quoted, quoted } from './quoted.js';
import { isThenable, type MaybePromise } from '@jesscss/awaitable-pipe';
import { isNode } from './util/is-node.js';
import { N } from './node-type.js';
import { canReuseLeaf, copyWithReusableLeaves, reuseLeaf } from './util/cloning.js';
import {
  isRenderBuffer,
  prepareBufferPrintState,
  type RenderBuffer,
  writePreparedRenderText,
  writeRenderText
} from './util/render-buffer.js';

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

function rawInterpolationKey(value: string): string | undefined {
  const raw = value.trim();
  if (
    raw.length < 4
    || raw.charCodeAt(0) !== 0x40
    || raw.charCodeAt(1) !== 0x7b
    || raw.charCodeAt(raw.length - 1) !== 0x7d
  ) {
    return undefined;
  }
  const key = raw.slice(2, -1);
  return key.includes('}') ? undefined : key;
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
      const key = rawInterpolationKey(value.value);
      if (key !== undefined) {
        const rules = this.rulesParent;
        if (rules) {
          const found = rules.find('declaration', key, 'VarDeclaration');
          const decl = Array.isArray(found) ? found[0] : found;
          if (decl && isNode(decl, N.VarDeclaration)) {
            const out = decl.value.value.resolve(context);
            if (isThenable(out)) {
              return out.then(evaluated => quoted(String(evaluated.valueOf())));
            }
            return quoted(String(out.valueOf()));
          }
        }
      }
    }
    return value?.resolve(context);
  }

  private renderAttributeParts(
    name: string | Node,
    value: Node | undefined,
    options: FinalPrintOptions
  ): void {
    const w = options.writer;
    const { op, mod } = this.value;
    w.add('[');
    if (typeof name === 'string') {
      w.add(name, this);
    } else {
      name.writeSyntax(options);
    }
    if (op) {
      w.add(op);
    }
    if (value) {
      value.writeSyntax(options);
    }
    if (mod) {
      w.add(' ');
      w.add(mod);
    }
    w.add(']');
  }

  private scalarAttributeValueText(value: Node | undefined): string | undefined {
    if (!value) {
      return '';
    }
    if (value instanceof Any && typeof value.value === 'string') {
      return value.value;
    }
    if (value instanceof Quoted) {
      const quotedValue = value.value;
      const quote = value._options?.quote ?? '"';
      const escapeChar = value._options?.escaped ? '~' : '';
      if (typeof quotedValue === 'string') {
        return escapeChar + quote + quotedValue + quote;
      }
      if (quotedValue instanceof Any && typeof quotedValue.value === 'string') {
        return escapeChar + quote + quotedValue.value + quote;
      }
    }
    return undefined;
  }

  private writeDirectAttributeText(
    name: string | Node,
    value: Node | undefined,
    options?: FinalPrintOptions
  ): string | undefined {
    if (typeof name !== 'string' || options?.trivia) {
      return undefined;
    }
    const { op, mod } = this.value;
    let out = `[${name}`;
    if (op) {
      const valueText = this.scalarAttributeValueText(value);
      if (valueText === undefined) {
        return undefined;
      }
      out += op + valueText;
    } else if (value) {
      return undefined;
    }
    if (mod) {
      out += ` ${mod}`;
    }
    out += ']';
    if (options) {
      const w = options.writer;
      w.add('[');
      w.add(name, this);
      if (op) {
        w.add(op);
        if (value instanceof Any && typeof value.value === 'string') {
          w.add(value.value, value);
        } else {
          const valueText = this.scalarAttributeValueText(value);
          if (valueText) {
            w.add(valueText, value);
          }
        }
      }
      if (mod) {
        w.add(' ');
        w.add(mod);
      }
      w.add(']');
    }
    return out;
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
      const key = rawInterpolationKey(value.value);
      if (key !== undefined) {
        const rules = this.rulesParent;
        if (rules) {
          const found = rules.find('declaration', key, 'VarDeclaration');
          const decl = Array.isArray(found) ? found[0] : found;
          if (decl && isNode(decl, N.VarDeclaration)) {
            const out = decl.value.value.eval(context);
            if (isThenable(out)) {
              return out.then((evaluated) => {
                return this.createResolvedValueNode(evaluated);
              });
            }
            return this.createResolvedValueNode(out);
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
      return name.then((resolvedName) => {
        if (isThenable(value)) {
          return value.then((resolvedValue) => {
            return finalize(resolvedName, resolvedValue);
          });
        }
        return finalize(resolvedName, value);
      });
    }
    if (isThenable(value)) {
      return value.then((resolvedValue) => {
        return finalize(name, resolvedValue);
      });
    }
    return finalize(name, value);
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
    if (
      typeof currentName === 'string'
      && !this.value.op
      && !this.value.value
      && !this.value.mod
    ) {
      const out = `[${currentName}]`;
      if (buffer) {
        return writeRenderText(buffer, out);
      }
      getPrintOptions(printOptions).writer.add(out, this);
      return out;
    }
    const name = typeof currentName === 'string' ? currentName : currentName.resolve(context);
    const value = this.resolveAttributeValue(context);
    const finalize = (resolvedName: string | Node, resolvedValue: Node | undefined): string => {
      const directOptions = !buffer && typeof resolvedName === 'string'
        ? getPrintOptions(printOptions)
        : undefined;
      const direct = buffer && options?.trivia
        ? undefined
        : this.writeDirectAttributeText(resolvedName, resolvedValue, directOptions);
      if (direct !== undefined) {
        if (buffer) {
          return writeRenderText(buffer, direct);
        }
        return direct;
      }
      const prepared = buffer
        ? prepareBufferPrintState(context, options, buffer)
        : prepareRenderPrintState(context, printOptions);
      const mark = prepared.writer.mark();
      this.renderAttributeParts(resolvedName, resolvedValue, prepared);
      const out = prepared.writer.getSince(mark);
      return buffer ? writePreparedRenderText(buffer, prepared, mark, out) : out;
    };
    if (isThenable(name)) {
      return name.then((resolvedName) => {
        if (isThenable(value)) {
          return value.then(resolvedValue => finalize(resolvedName, resolvedValue));
        }
        return finalize(resolvedName, value);
      });
    }
    if (isThenable(value)) {
      return value.then(resolvedValue => finalize(name, resolvedValue));
    }
    return finalize(name, value);
  }

  override toTrimmedString(options?: PrintOptions) {
    const printOptions = getPrintOptions(options);
    const { name, op, value, mod } = this.value;
    if (typeof name === 'string' && !op && !value && !mod) {
      const out = `[${name}]`;
      printOptions.writer.add(out, this);
      return out;
    }
    const direct = this.writeDirectAttributeText(name, value, printOptions);
    if (direct !== undefined) {
      return direct;
    }
    const mark = printOptions.writer.mark();
    this.renderAttributeParts(name, value, printOptions);
    const w = printOptions.writer;
    return w.getSince(mark);
  }

  /** @internal */
  override writeSyntax(options: FinalPrintOptions): void {
    this.renderAttributeParts(this.value.name, this.value.value, options);
  }

  override valueOf() {
    let valueOf = this._valueOf;
    if (!valueOf) {
      let { name, op, value, mod } = this.value;
      /** Attributes are case-insensitive */
      let keyStr = (typeof name === 'string' ? name : String(name.valueOf())).toLowerCase();
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
