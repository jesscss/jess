import type { MaybePromise } from 'awaitable-pipe';
import { F_VISIBLE, Node, type NodeOptions, type NodeValue, defineType } from './node.js';
import type { IfAny } from 'type-fest';
import type { Context } from '../context.js';
import type { Nil } from './nil.js';
import { BitSetLibrary, BitSet } from './util/bitset.js';

const { isArray } = Array;
/**
 * This represents anything that is valid in a selector
 *
 * @todo - Add Sass private / placeholder selectors?
 *   e.g. `\\foo` instead of `%foo`
 *       private = `\\_foo`
 */

export interface Selector<T = any, O extends NodeOptions = NodeOptions> extends Node<IfAny<T, NodeValue, T>, O> {
  valueOf(): string;
  getKeySet(context?: Context): BitSet<string>;
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
  isSelector = true;

  protected _valueOf: string | undefined;

  keySetLibrary: BitSetLibrary<string> | undefined;

  protected _requireKeySetLibrary(context?: Context): BitSetLibrary<string> {
    const { keySetLibrary, sourceNode, parent } = this;
    const sourceLibrary = (
      sourceNode !== this
      && (sourceNode as Selector).isSelector
    )
      ? (sourceNode as Selector).keySetLibrary
      : undefined;
    const parentLibrary = (
      parent !== this
      && (parent as Selector | undefined)?.isSelector
    )
      ? (parent as Selector).keySetLibrary
      : undefined;
    const treeContext = this.treeContext as
      | { selectorBits?: BitSetLibrary<string>; opts?: { selectorBits?: BitSetLibrary<string> } }
      | undefined;
    const library = keySetLibrary
      ?? parentLibrary
      ?? sourceLibrary
      ?? context?.selectorBits
      ?? treeContext?.selectorBits
      ?? treeContext?.opts?.selectorBits;
    if (library) {
      this.keySetLibrary ??= library;
      return library;
    }
    const selectorText = String(this.valueOf?.() ?? '');
    const parentType = (parent as { type?: string } | undefined)?.type ?? 'none';
    const sourceType = (sourceNode as { type?: string } | undefined)?.type ?? 'none';
    throw new Error(`Selector keySet library not found (${this.type}: ${selectorText}; parent=${parentType}; source=${sourceType})`);
  }

  override inherit(node?: Node | undefined): this {
    if (!node) {
      return this;
    }
    const inherited = super.inherit(node);
    if (node && (node as Selector).isSelector) {
      inherited.keySetLibrary ??= (node as Selector).keySetLibrary;
    }
    const { value } = inherited as Record<string, unknown>;
    if (isArray(value)) {
      for (const item of value) {
        if ((item as Selector | undefined)?.isSelector) {
          inherited.adopt(item as Selector);
        }
      }
    } else if (value && typeof value === 'object') {
      const arg = (value as { arg?: unknown }).arg;
      if ((arg as Selector | undefined)?.isSelector) {
        inherited.adopt(arg as Selector);
      }
    }
    return inherited;
  }

  override clone(deep?: boolean, cloneFn?: (n: Node) => Node): this {
    const cloned = super.clone(deep, cloneFn);
    cloned.keySetLibrary = this.keySetLibrary;
    return cloned;
  }

  protected override evalNode(context: Context): MaybePromise<Node> {
    const { selectorBits } = context;
    const { sourceNode } = this;
    this.keySetLibrary ??= selectorBits;
    if (sourceNode !== this && (sourceNode as Selector).isSelector) {
      (sourceNode as Selector).keySetLibrary ??= selectorBits;
    }
    return super.evalNode(context);
  }

  /**
   * A set of all simplified (valueOf) selectors,
   * for easy lookup to see if the selector is extendable
   * by the key sets in the extend scope.
   */
  protected _keySet: BitSet<string> | undefined;
  /** Used for mixin registry indexing - only includes visible selectors */
  protected _visibleKeySet: BitSet<string> | undefined;
  /**
   * Like keySet but excludes keys inside `:is()` SelectorList args.
   * For `:is(.a, .b) .c`, requiredKeySet = `{.c}` while keySet = `{.a, .b, .c}`.
   * Safe for subset rejection: if requiredKeySet keys aren't in target, no match possible.
   */
  protected _requiredKeySet: BitSet<string> | undefined;

  get keySet() {
    if (!this._keySet) {
      this.computeKeySets();
    }
    return this._keySet!;
  }

  getKeySet(context?: Context): BitSet<string> {
    if (!context) {
      return this.keySet;
    }
    const library = this._requireKeySetLibrary(context);
    const { value } = this as Record<string, unknown>;
    if (isArray(value)) {
      let keySet: BitSet<string> | undefined;
      for (const child of value as Selector[]) {
        const childKeySet = child.getKeySet(context);
        keySet = keySet ? keySet.or(childKeySet) : childKeySet.clone();
      }
      return keySet ?? library.getBitset();
    }
    const selectorValue = String((this as unknown as { valueOf(context?: Context): string }).valueOf(context));
    return library.getBitset([selectorValue]);
  }

  get visibleKeySet() {
    if (!this._visibleKeySet) {
      this.computeKeySets();
    }
    return this._visibleKeySet!;
  }

  get requiredKeySet() {
    if (!this._requiredKeySet) {
      this.computeKeySets();
    }
    return this._requiredKeySet!;
  }

  invalidateCache(): void {
    this._valueOf = undefined;
    this._keySet = undefined;
    this._visibleKeySet = undefined;
    this._requiredKeySet = undefined;
  }

  /**
   * Computes keySet, visibleKeySet, and requiredKeySet in one pass.
   * Subclasses should override this to implement their specific logic.
   */
  protected computeKeySets(): void {
    if (this._keySet && this._visibleKeySet && this._requiredKeySet) {
      return;
    }
    const library = this._requireKeySetLibrary();
    const { value } = this as Record<string, unknown>;
    if (isArray(value)) {
      let keySet: BitSet<string> | undefined;
      let visibleKeySet: BitSet<string> | undefined;
      let requiredKeySet: BitSet<string> | undefined;
      for (const child of value as Selector[]) {
        const childKeySet = child.keySet;
        keySet = keySet
          ? keySet.or(childKeySet)
          : childKeySet.clone();
        visibleKeySet = visibleKeySet
          ? visibleKeySet.or(child.visibleKeySet)
          : child.visibleKeySet.clone();
        requiredKeySet = requiredKeySet
          ? requiredKeySet.or(child.requiredKeySet)
          : child.requiredKeySet.clone();
      }
      this._keySet = keySet ?? library.getBitset();
      this._visibleKeySet = visibleKeySet ?? library.getBitset();
      this._requiredKeySet = requiredKeySet ?? library.getBitset();
      return;
    }
    const selectorValue = String(this.valueOf());
    this._keySet = library.getBitset([selectorValue]);
    this._requiredKeySet = this._keySet;

    if (this.hasFlag(F_VISIBLE)) {
      this._visibleKeySet = this._keySet;
    } else {
      this._visibleKeySet = library.getBitset();
    }
  }
}

defineType(Selector, 'Selector');
