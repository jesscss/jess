import type { MaybePromise } from 'awaitable-pipe';
import { F_VISIBLE, Node, type NodeOptions, type NodeValue, defineType } from './node.js';
import type { IfAny } from 'type-fest';
import type { Context } from '../context.js';
import type { Nil } from './nil.js';
import { type BitSetLibrary, BitSet } from './util/bitset.js';

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
  eval(context: Context): MaybePromise<Selector<T>> | MaybePromise<Nil>;
}

export abstract class Selector<T = any, O extends NodeOptions = NodeOptions> extends Node<IfAny<T, NodeValue, T>, O> {
  isSelector = true;

  protected _valueOf: string | undefined;

  keySetLibrary: BitSetLibrary<string> | undefined;

  protected override evalNode(context: Context): MaybePromise<Node> {
    this.keySetLibrary = context.selectorBits;
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
    let library = this.keySetLibrary;
    if (!library) {
      throw new Error('Selector keySet library not found');
    }

    let data = this.data;
    if (isArray(data)) {
      for (const child of data as Selector[]) {
        let childKeySet = child.keySet;
        this._keySet = this._keySet ? this._keySet.or(childKeySet) : childKeySet.clone();
        this._visibleKeySet = this._visibleKeySet
          ? this._visibleKeySet.or(child.visibleKeySet)
          : child.visibleKeySet.clone();
        this._requiredKeySet = this._requiredKeySet
          ? this._requiredKeySet.or(child.requiredKeySet)
          : child.requiredKeySet.clone();
      }
      return;
    }
    let value = String(this.valueOf());
    this._keySet = library.getBitset([value]);
    this._requiredKeySet = this._keySet;

    if (this.hasFlag(F_VISIBLE)) {
      this._visibleKeySet = this._keySet;
    } else {
      this._visibleKeySet = library.getBitset();
    }
  }
}

defineType(Selector, 'Selector');
