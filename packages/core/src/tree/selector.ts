import type { MaybePromise } from 'awaitable-pipe';
import { F_VISIBLE, Node, type NodeOptions, type NodeValue, defineType } from './node.js';
import type { IfAny } from 'type-fest';
import type { Context } from '../context.js';
import type { Nil } from './nil.js';

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
      // Trigger computation of both keySet and canFastReject together
      this._computeKeySetAndFastReject();
    }
    return this._canFastReject!;
  }

  /**
   * Computes both keySet and canFastReject in one pass for efficiency.
   * Subclasses should override this to implement their specific logic.
   */
  protected _computeKeySetAndFastReject(): void {
    // Default implementation - subclasses override
    let value = String(this.valueOf());
    this._keySet = new Set([value]);
    if (this.hasFlag(F_VISIBLE)) {
      this._visibleKeySet = this._keySet;
    } else {
      this._visibleKeySet = new Set();
    }
    this._canFastReject = true;
  }
}

defineType(Selector, 'Selector');