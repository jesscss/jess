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
    // this.computeKeySetAndFastReject();
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

  get keySet() {
    let keySet = this._keySet;
    if (!keySet) {
      this.computeKeySetAndFastReject();
    }
    return this._keySet!;
  }

  get visibleKeySet() {
    let visibleKeySet = this._visibleKeySet;
    if (!visibleKeySet) {
      this.computeKeySetAndFastReject();
    }
    return this._visibleKeySet!;
  }

  /**
   * Cached computation: can this selector's keySet be trusted for disjoint rejection?
   * True = keySet represents exact requirements (no alternatives)
   * False = keySet contains alternatives/unions, disjoint check unreliable
   */
  canFastReject: boolean | undefined;

  /**
   * Computes both keySet and canFastReject in one pass for efficiency.
   * Subclasses should override this to implement their specific logic.
   */
  protected computeKeySetAndFastReject(): void {
    let keySet = this._keySet;
    let visibleKeySet = this._visibleKeySet;
    if (keySet && visibleKeySet) {
      return;
    }
    // Default implementation - subclasses override
    let library = this.keySetLibrary;
    if (!library) {
      throw new Error('Selector keySet library not found');
    }

    let data = this.data;
    if (isArray(data)) {
      /** Aggregate children keysets */
      let childCanReject = true;
      for (const child of data as Selector[]) {
        let childKeySet = child.keySet;
        let keySet = this._keySet;
        let visibleKeySet = this._visibleKeySet;
        this._keySet = keySet ? keySet.or(childKeySet) : childKeySet.clone();
        this._visibleKeySet = visibleKeySet ? visibleKeySet.or(child.visibleKeySet) : child.visibleKeySet.clone();
        childCanReject &&= Boolean(child.canFastReject);
      }
      this.canFastReject = childCanReject;
      return;
    }
    let value = String(this.valueOf());
    this._keySet = library.getBitset([value]);

    if (this.hasFlag(F_VISIBLE)) {
      this._visibleKeySet = this._keySet;
    } else {
      this._visibleKeySet = library.getBitset();
    }
    this.canFastReject = true;
  }
}

defineType(Selector, 'Selector');