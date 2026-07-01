import { defineType, Node, type LocationInfo } from './node.js';
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

/**
 * An attribute selector
 * @see https://developer.mozilla.org/en-US/docs/Web/CSS/Attribute_selectors
 *   e.g. [id="foo"]
*/
export class AttributeSelector extends SimpleSelector<AttributeSelectorValue> {
  // Exception to the "separate field values" rule: the `{name, op, value, mod}`
  // record is a normalization decomposition, so the whole object IS this node's
  // canonical `value` (stored + typed by the Selector base, childKeys=['value']).
  // The base walks it for parenting/clone; parts are exposed as getters so call
  // sites keep reading `this.name` / `this.attributeValue`.
  get name(): AttributeSelectorValue['name'] { return this.value.name; }
  get op(): string | undefined { return this.value.op; }
  get attributeValue(): Node | undefined { return this.value.value; }
  get mod(): string | undefined { return this.value.mod; }

  private resolveAttributeValue(context: Context): MaybePromise<Node | undefined> {
    const value = this.attributeValue;
    if (value instanceof Any && typeof value.value === 'string') {
      const raw = value.value.trim();
      const m = raw.match(/^@\{([^}]+)\}$/);
      if (m) {
        const key = m[1]!;
        const rules = this.rulesParent;
        if (rules) {
          const decl = findAttributeVarDeclaration(rules, key);
          if (decl) {
            const declValue = decl.value;
            if (!(declValue instanceof Node)) {
              return undefined;
            }
            const out = declValue.resolve(context);
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
    if (value instanceof Any && typeof value.value === 'string') {
      const raw = value.value.trim();
      const m = raw.match(/^@\{([^}]+)\}$/);
      if (m) {
        const key = m[1]!;
        const rules = this.rulesParent;
        if (rules) {
          const decl = findAttributeVarDeclaration(rules, key);
          if (decl) {
            const declValue = decl.value;
            if (!(declValue instanceof Node)) {
              return undefined;
            }
            const out = declValue.eval(context);
            if (isThenable(out)) {
              return (out as Promise<Node>).then(evaluated => quoted(String(evaluated.valueOf())));
            }
            return quoted(String((out as Node).valueOf()));
          }
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
    const ownedName = typeof resolvedName === 'string'
      ? resolvedName
      : resolvedName === currentName
        ? resolvedName.canReuseAsLeaf() ? resolvedName.reuseAsLeaf() : resolvedName.cloneForPlacement()
        : resolvedName.canReuseAsLeaf() ? resolvedName.reuseAsLeaf() : resolvedName.cloneForPlacement();
    const ownedValue = resolvedValue
      ? resolvedValue === currentValue
        ? resolvedValue.canReuseAsLeaf() ? resolvedValue.reuseAsLeaf() : resolvedValue.cloneForPlacement()
        : resolvedValue.canReuseAsLeaf() ? resolvedValue.reuseAsLeaf() : resolvedValue.cloneForPlacement()
      : undefined;
    const node = new AttributeSelector(
      {
        name: ownedName,
        op: this.op,
        value: ownedValue,
        mod: this.mod
      },
      // AttributeSelector constructor has options?: undefined
      undefined,
      // NodeLocation (LocationInfo | []) is compatible with LocationInfo; [] case won't match LocationInfo | 0
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      this.location as LocationInfo | 0
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
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    return this.resolveForRender(context) as MaybePromise<this>;
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
    // `0` is a legacy no-op location sentinel; convert to undefined for base class.
    // The Selector base stores `this.value = value`; we only add treeContext.
    super(value, options, location === 0 ? undefined : location);
    this._treeContext = treeContext;
  }
}

/** Not sure why types couldn't be properly inferred */
// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
export const attr = defineType<AttributeSelectorValue>(AttributeSelector, 'AttributeSelector', 'attr') as (
  value: AttributeSelectorValue,
  options?: undefined,
  location?: LocationInfo | 0
) => AttributeSelector;
