import { defineType, F_NON_STATIC, type LocationInfo, type Node } from './node.js';
import { SimpleSelector } from './selector-simple.js';
import { type PrintOptions, getPrintOptions, prepareRenderPrintState } from './util/print.js';
import type { Context } from '../context.js';
import { Any } from './any.js';
import { quoted } from './quoted.js';
import { isThenable, type MaybePromise } from '@jesscss/awaitable-pipe';
import { isNode } from './util/is-node.js';
import { N } from './node-type.js';
import {
  isRenderBuffer,
  prepareBufferPrintState,
  type RenderBuffer,
  writeRenderText
} from './util/render-buffer.js';
import type { Rules } from './rules.js';
import type { VarDeclaration } from './declaration-var.js';
import { findVariableDeclarationOccurrence } from './util/direct-rules-lookup.js';

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
  const found = findVariableDeclarationOccurrence(rules, key)?.node;
  return isNode(found, N.VarDeclaration) ? found : undefined;
}

function rawAttributeInterpolationKey(value: Node | undefined): string | undefined {
  if (!(value instanceof Any) || typeof value.value !== 'string') {
    return undefined;
  }
  const match = value.value.trim().match(/^@\{([^}]+)\}$/);
  return match?.[1];
}

/**
 * An attribute selector
 * @see https://developer.mozilla.org/en-US/docs/Web/CSS/Attribute_selectors
 *   e.g. [id="foo"]
*/
export class AttributeSelector extends SimpleSelector<AttributeSelectorValue> {
  static override childKeys = ['name', 'attributeValue'] as const;

  readonly name: AttributeSelectorValue['name'];
  readonly op: string | undefined;
  readonly attributeValue: Node | undefined;
  readonly mod: string | undefined;

  private getAttributeLookupRules(context: Context): Rules | undefined {
    return this.rulesParent ?? context.rulesContext;
  }

  private resolveAttributeValue(context: Context): MaybePromise<Node | undefined> {
    const value = this.attributeValue;
    const key = rawAttributeInterpolationKey(value);
    if (key !== undefined) {
      const rules = this.getAttributeLookupRules(context);
      if (rules) {
        const decl = findAttributeVarDeclaration(rules, key);
        if (decl) {
          const out = decl.valueNode.resolve(context);
          if (isThenable(out)) {
            return (out as Promise<Node>).then(evaluated => quoted(String(evaluated.valueOf())));
          }
          return quoted(String((out as Node).valueOf()));
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

  private renderAttributeSyntax(options?: PrintOptions): string {
    return this.renderAttributeParts(this.name, this.attributeValue, options);
  }

  override evalNode(context: Context): MaybePromise<Node> {
    const currentName = this.name;
    const currentValue = this.attributeValue;
    const name = typeof currentName === 'string' ? currentName : currentName.eval(context);
    const value = this.evaluateAttributeValue(context);
    const finalize = (evaluatedName: string | Node, evaluatedValue: Node | undefined): Node => {
      if (evaluatedName === currentName && evaluatedValue === currentValue) {
        return this;
      }
      return this.createResolvedAttributeSelector(currentName, currentValue, evaluatedName, evaluatedValue);
    };
    if (isThenable(name)) {
      return (name as Promise<string | Node>).then((evaluatedName) => {
        if (isThenable(value)) {
          return (value as Promise<Node | undefined>).then(evaluatedValue => finalize(evaluatedName, evaluatedValue));
        }
        return finalize(evaluatedName, value as Node | undefined);
      });
    }
    if (isThenable(value)) {
      return (value as Promise<Node | undefined>).then(evaluatedValue => finalize(name as string | Node, evaluatedValue));
    }
    return finalize(name as string | Node, value as Node | undefined);
  }

  private evaluateAttributeValue(context: Context): MaybePromise<Node | undefined> {
    const value = this.attributeValue;
    // Handle Less interpolation that the parser may have left as a raw token in selectors:
    //   [data=@{attr-data}]
    // In Less semantics this should resolve to the variable value and be serialized quoted.
    const key = rawAttributeInterpolationKey(value);
    if (key !== undefined) {
      const rules = this.getAttributeLookupRules(context);
      if (rules) {
        const decl = findAttributeVarDeclaration(rules, key);
        if (decl) {
          const out = decl.valueNode.eval(context);
          if (isThenable(out)) {
            return (out as Promise<Node>).then(evaluated => quoted(String(evaluated.valueOf())));
          }
          return quoted(String((out as Node).valueOf()));
        }
      }
    }
    return value?.eval(context) as MaybePromise<Node | undefined>;
  }

  private createResolvedAttributeSelector(
    currentName: string | Node,
    currentValue: Node | undefined,
    resolvedName: string | Node,
    resolvedValue: Node | undefined
  ): AttributeSelector {
    const node = new AttributeSelector(
      {
        name: resolvedName,
        op: this.op,
        value: resolvedValue,
        mod: this.mod
      },
      this._options,
      this.location
    );
    node.inherit(this);
    return node;
  }

  protected override resolveForRender(context: Context): MaybePromise<AttributeSelector> {
    const currentName = this.name;
    const currentValue = this.attributeValue;
    const name = typeof currentName === 'string' ? currentName : currentName.resolve(context);
    const value = this.resolveAttributeValue(context);
    const finalize = (resolvedName: string | Node, resolvedValue: Node | undefined): AttributeSelector => {
      if (resolvedName === currentName && resolvedValue === currentValue) {
        return this;
      }
      return this.createResolvedAttributeSelector(currentName, currentValue, resolvedName, resolvedValue);
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
    const currentName = this.name;
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
      const { name, op, attributeValue: value, mod } = this;
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

  constructor(
    value: AttributeSelectorValue,
    options?: undefined,
    location?: LocationInfo | 0,
    treeContext?: Context['treeContext']
  ) {
    super(value, options, location, false);
    this.name = value.name;
    this.op = value.op;
    this.attributeValue = value.value;
    this.mod = value.mod;
    this._treeContext = treeContext;
    if (isNode(this.name)) {
      this.adopt(this.name);
    }
    if (this.attributeValue) {
      this.adopt(this.attributeValue);
    }
    if (rawAttributeInterpolationKey(this.attributeValue) !== undefined) {
      this.addFlag(F_NON_STATIC);
    }
  }
}

/** Not sure why types couldn't be properly inferred */
export const attr = defineType<AttributeSelectorValue>(AttributeSelector, 'AttributeSelector', 'attr') as (
  value: AttributeSelectorValue,
  options?: undefined,
  location?: LocationInfo | 0
) => AttributeSelector;
