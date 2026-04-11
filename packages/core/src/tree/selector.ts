import type { MaybePromise } from 'awaitable-pipe';
import { F_VISIBLE, Node, type NodeOptions, type NodeValue, defineType } from './node.js';
import type { IfAny } from 'type-fest';
import type { Context } from '../context.js';
import type { Nil } from './nil.js';
import { type BitSet, type BitSetLibrary } from './util/bitset.js';

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

  /**
   * A set of all simplified (valueOf) selectors,
   * for easy lookup to see if the selector is extendable
   * by the key sets in the extend scope.
   */
  protected _keySet: Set<string> | undefined;
  /** Used for mixin registry indexing - only includes visible selectors */
  protected _visibleKeySet: Set<string> | undefined;
  get keySet(): Set<string> {
    if (!this._keySet) {
      this._computeKeySetAndFastReject();
    }
    return this._keySet!;
  }

  get visibleKeySet(): Set<string> {
    if (!this._visibleKeySet) {
      this._computeKeySetAndFastReject();
    }
    return this._visibleKeySet!;
  }

  /**
   * Cached computation: can this selector's keySet be trusted for disjoint rejection?
   * True = keySet represents exact requirements (no alternatives)
   * False = keySet contains alternatives/unions, disjoint check unreliable
   */
  protected _canFastReject: boolean | undefined;

  get canFastReject(): boolean {
    if (this._canFastReject === undefined) {
      this._computeKeySetAndFastReject();
    }
    return this._canFastReject!;
  }

  /**
   * BitSet-based key properties for O(1) extend rejection. These are
   * public so that consumers (notably `selector-match-core`) can peek
   * at "has this been computed?" without forcing the lazy computation
   * via the `keyBits` getter. Computation has side effects (child walks)
   * that callers in fast-reject paths want to avoid.
   */
  keySetLibrary: BitSetLibrary<string> | undefined;
  _keyBits: BitSet<string> | undefined;
  _visibleKeyBits: BitSet<string> | undefined;
  _requiredKeyBits: BitSet<string> | undefined;

  get keyBits(): BitSet<string> {
    if (!this._keyBits) {
      this._computeKeySetAndFastReject();
    }
    return this._keyBits!;
  }

  get visibleKeyBits(): BitSet<string> {
    if (!this._visibleKeyBits) {
      this._computeKeySetAndFastReject();
    }
    return this._visibleKeyBits!;
  }

  /**
   * Required keys — excludes OR paths (e.g., SelectorList inside :is()).
   * If a target doesn't have ALL required bits, it can't match this selector.
   */
  get requiredKeyBits(): BitSet<string> {
    if (!this._requiredKeyBits) {
      this._computeKeySetAndFastReject();
    }
    return this._requiredKeyBits!;
  }

  /**
   * Context-aware key computation. If context provided, walks children
   * recursively. Otherwise returns cached keyBits.
   */
  getKeyBits(context?: Context): BitSet<string> {
    if (!context) {
      return this.keyBits;
    }
    const library = context.selectorBits;
    this.keySetLibrary ??= library;

    const children = (this as any).value;
    if (isArray(children)) {
      let bits: BitSet<string> | undefined;
      for (const child of children as Selector[]) {
        if (!(child as any).isSelector) {
          continue;
        }
        const childBits = child.getKeyBits(context);
        bits = bits ? bits.or(childBits) : childBits.clone();
      }
      return bits ?? library.getBitset();
    }

    const value = String(this.valueOf());
    return library.getBitset([value]);
  }

  /**
   * Computes both keySet and canFastReject in one pass for efficiency.
   * Subclasses should override this to implement their specific logic.
   */
  protected _computeKeySetAndFastReject(): void {
    let value = String(this.valueOf());
    this._keySet = new Set([value]);
    if (this.hasFlag(F_VISIBLE)) {
      this._visibleKeySet = this._keySet;
    } else {
      this._visibleKeySet = new Set();
    }
    this._canFastReject = true;

    if (this.keySetLibrary) {
      const lib = this.keySetLibrary;
      this._keyBits = lib.getBitset([value]);
      this._visibleKeyBits = this.hasFlag(F_VISIBLE) ? this._keyBits : lib.getBitset();
      this._requiredKeyBits = this._keyBits;
    }
  }
}

defineType(Selector, 'Selector');