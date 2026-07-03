import { isThenable, type MaybePromise } from '@jesscss/awaitable-pipe';
import { Node, type NodeLocation, type NodeOptions, type NodeValue, defineType } from './node.js';
import type { IfAny } from 'type-fest';
import type { Context } from '../context.js';
import type { Nil } from './nil.js';
import { BitSetLibrary } from './util/bitset.js';
import type { RenderBuffer } from './util/render-buffer.js';
import type { FinalPrintOptions, PrintOptions } from './util/print.js';

const { isArray } = Array;

function isSelector(value: unknown): value is Selector {
  return value instanceof Selector;
}

function selectorArray(value: unknown): Selector[] | undefined {
  if (!isArray(value)) {
    return undefined;
  }
  return value.every(isSelector) ? value : undefined;
}

function selectorArg(value: unknown): Selector | undefined {
  if (typeof value !== 'object' || value === null || !('arg' in value)) {
    return undefined;
  }
  const { arg } = value;
  return isSelector(arg) ? arg : undefined;
}

function nodeType(value: Node | undefined): string {
  return value?.type ?? 'none';
}

/**
 * A single selector value: a selector node, or a plain string leaf. String-backed
 * basic selectors and combinators are strings, so a bare `string` IS a selector.
 * (Once `BasicSelector` is deleted and the base class is renamed, this becomes the
 * canonical `Selector` and the `| string` folds away.)
 */
export type SelectorValue = Selector | string;

/**
 * Anything accepted where a selector is expected: a single selector value, or an
 * array of them. An array stands in for a `SelectorList` — no wrapper node needed.
 */
export type SelectorLike = SelectorValue | SelectorValue[];

/**
 * This represents anything that is valid in a selector
 *
 * @todo - Add Sass private / placeholder selectors?
 *   e.g. `\\foo` instead of `%foo`
 *       private = `\\_foo`
 */

export interface Selector<T = any, O extends NodeOptions = NodeOptions> extends Node<IfAny<T, NodeValue, T>, O> {
  valueOf(): string;
  eval(context: Context): MaybePromise<Selector<T>> | MaybePromise<Nil>;
}

export function attachSelectorBitLibrary<T extends Selector>(
  selector: T,
  library: BitSetLibrary<string> | undefined
): T {
  selector.keySetLibrary = library;
  return selector;
}

export abstract class Selector<T = any, O extends NodeOptions = NodeOptions> extends Node<IfAny<T, NodeValue, T>, O> {
  static override childKeys: readonly string[] | null = ['value'];

  readonly value: IfAny<T, NodeValue, T>;

  constructor(value: IfAny<T, NodeValue, T>, options?: O, location?: NodeLocation) {
    super(value, options, location);
    // Invariant 7: each node owns its value; the base stores nothing.
    this.value = value;
  }

  isSelector = true;

  protected _valueOf: string | undefined;

  keySetLibrary: BitSetLibrary<string> | undefined;

  /**
   * Resolve the bit-set library this selector belongs to (own, else parent/source,
   * else context/tree). Used by the SelectorAnalysis free helpers to look up the
   * right service instance — the node no longer surfaces key-set getters itself.
   */
  requireKeySetLibrary(context?: Context): BitSetLibrary<string> {
    const { keySetLibrary, sourceNode, parent } = this;
    const sourceLibrary = sourceNode !== this && isSelector(sourceNode)
      ? sourceNode.keySetLibrary
      : undefined;
    const parentLibrary = parent !== this && isSelector(parent)
      ? parent.keySetLibrary
      : undefined;
    const treeContext = this.sourceRoot?._treeContext;
    const library = keySetLibrary
      ?? parentLibrary
      ?? sourceLibrary
      ?? context?.selectorBits
      ?? treeContext?.opts?.selectorBits;
    if (library) {
      this.keySetLibrary ??= library;
      return library;
    }
    const selectorText = String(this.valueOf?.() ?? '');
    const parentType = nodeType(parent);
    const sourceType = nodeType(sourceNode);
    throw new Error(`Selector keySet library not found (${this.type}: ${selectorText}; parent=${parentType}; source=${sourceType})`);
  }

  override inherit(node?: Node | undefined): this {
    if (!node) {
      return this;
    }
    const inherited = super.inherit(node);
    if (isSelector(node)) {
      inherited.keySetLibrary ??= node.keySetLibrary;
    }
    const selectors = selectorArray(inherited.value);
    if (selectors) {
      for (const item of selectors) {
        inherited.adopt(item);
      }
    } else {
      const arg = selectorArg(inherited.value);
      if (arg) {
        inherited.adopt(arg);
      }
    }
    return inherited;
  }

  override clone(cloneFn?: (n: Node) => Node): this {
    const cloned = super.clone(cloneFn);
    cloned.keySetLibrary = this.keySetLibrary;
    return cloned;
  }

  protected override evalNode(context: Context): MaybePromise<Node> {
    const { selectorBits } = context;
    const { sourceNode } = this;
    this.keySetLibrary ??= selectorBits;
    if (sourceNode !== this && isSelector(sourceNode)) {
      sourceNode.keySetLibrary ??= selectorBits;
    }
    return super.evalNode(context);
  }

  protected resolveForRender(context: Context): MaybePromise<Node> {
    return this.evalNode(context);
  }

  override writeSyntax(options: FinalPrintOptions): void {
    this.toTrimmedString(options);
  }

  override render(context: Context, buffer: RenderBuffer, options?: PrintOptions): MaybePromise<string>;
  override render(context: Context, options?: PrintOptions): string;
  override render(context: Context, bufferOrOptions?: RenderBuffer | PrintOptions, options?: PrintOptions): string | MaybePromise<string> {
    const node = this.resolveForRender(context);
    return isThenable(node)
      ? (node as Promise<Node>).then(resolved => this.renderOutput(context, resolved, bufferOrOptions, options))
      : this.renderOutput(context, node as Node, bufferOrOptions, options);
  }

  // Selector key-sets (keySet / visibleKeySet / requiredKeySet) are owned entirely by
  // the SelectorAnalysis service — see util/selector-analysis.ts and its keySetOf /
  // visibleKeySetOf / requiredKeySetOf free helpers. The node holds no key-set getters
  // or fields; it only carries `keySetLibrary` so the service instance can be found.
  invalidateCache(): void {
    this._valueOf = undefined;
  }
}

defineType(Selector, 'Selector');
