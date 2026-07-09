import { sourceSpanOf } from './util/provenance.js';
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
 * Resolve the var declaration behind an attribute-value interpolation token (`[data=@{key}]`),
 * first via the node's `.parent`-derived `rulesParent`, then — when that is undefined — via the
 * LIVE FRAME STACK (`context.rulesetFrames`, innermost → outermost).
 *
 * WHY THE FRAME-STACK FALLBACK. The `rulesParent` walk relies on `.parent` back-pointers, which are
 * established only by the EVAL pass; the single-downward SPINE (which replaces that pass) never sets
 * them, so on the spine `rulesParent` is undefined and `[data=@{key}]` was left UNRESOLVED (a general
 * spine bug — `.@{name}` class interpolation resolves via `InterpolatedSelector.eval`, but the raw
 * `@{…}` token inside an `AttributeSelector` value does not). The spine DOES maintain the live scope
 * chain in `context.rulesetFrames` (the same stack `&`/interpolation resolution reads), so falling
 * back to it resolves the token exactly as the eval path does — WITHOUT any `.parent` dependency.
 *
 * SAFETY (shared node, both paths). The fallback fires ONLY when `rulesParent` is undefined. On the
 * EVAL path `.parent` is always set, so `rulesParent` is defined and the fallback never runs — the
 * eval path is byte-untouched. Verified empirically across the corpus.
 */
function findAttributeVarDeclarationInScope(
  node: { rulesParent: Rules | undefined },
  key: string,
  context: Context
): VarDeclaration | undefined {
  const rules = node.rulesParent;
  if (rules) {
    return findAttributeVarDeclaration(rules, key);
  }
  const frames = context.rulesetFrames;
  for (let i = frames.length - 1; i >= 0; i--) {
    const decl = findAttributeVarDeclaration(frames[i]!, key);
    if (decl) {
      return decl;
    }
  }
  return undefined;
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
  get name(): AttributeSelectorValue['name'] {
    return this.value.name;
  }

  get op(): string | undefined {
    return this.value.op;
  }

  get attributeValue(): Node | undefined {
    return this.value.value;
  }

  get mod(): string | undefined {
    return this.value.mod;
  }

  private resolveAttributeValue(context: Context): MaybePromise<Node | undefined> {
    const value = this.attributeValue;
    if (value instanceof Any && typeof value.value === 'string') {
      const raw = value.value.trim();
      const m = raw.match(/^@\{([^}]+)\}$/);
      if (m) {
        const key = m[1]!;
        const decl = findAttributeVarDeclarationInScope(this, key, context);
        if (decl) {
          const declValue = decl.value;
          if (!(declValue instanceof Node)) {
            return undefined;
          }
          const out = declValue.resolve(context);
          if (isThenable(out)) {
            return out.then(evaluated => quoted(String(evaluated.valueOf())));
          }
          return quoted(String(out.valueOf()));
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
      return name.then((evaluatedName) => {
        if (isThenable(value)) {
          return value.then(evaluatedValue => finalize(evaluatedName, evaluatedValue));
        }
        return finalize(evaluatedName, value);
      });
    }
    if (isThenable(value)) {
      return value.then(evaluatedValue => finalize(name, evaluatedValue));
    }
    return finalize(name, value);
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
        const decl = findAttributeVarDeclarationInScope(this, key, context);
        if (decl) {
          const declValue = decl.value;
          if (!(declValue instanceof Node)) {
            return undefined;
          }
          const out = declValue.eval(context);
          if (isThenable(out)) {
            return out.then(evaluated => quoted(String(evaluated.valueOf())));
          }
          return quoted(String(out.valueOf()));
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
      sourceSpanOf(this) as LocationInfo | 0
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

  override resolve(context: Context): MaybePromise<AttributeSelector> {
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
    location?: LocationInfo | 0
  ) {
    // `0` is a legacy no-op location sentinel; convert to undefined for base class.
    // The Selector base stores `this.value = value`.
    super(value, options, location === 0 ? undefined : location);
  }
}

/** Not sure why types couldn't be properly inferred */
// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
export const attr = defineType<AttributeSelectorValue>(AttributeSelector, 'AttributeSelector', 'attr') as (
  value: AttributeSelectorValue,
  options?: undefined,
  location?: LocationInfo | 0
) => AttributeSelector;
