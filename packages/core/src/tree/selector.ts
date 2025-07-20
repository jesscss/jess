import { Node, type NodeOptions, type NodeValue, defineType } from './node';
import type { IfAny } from 'type-fest';

/** This represents anything that is valid in a selector */

export interface Selector<T = any, O extends NodeOptions = NodeOptions> extends Node<IfAny<T, NodeValue, T>, O> {
  valueOf(): string;
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
  abstract keySet: Set<string>;

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
    this._keySet = new Set([String(this.valueOf())]);
    this._canFastReject = true;
  }
}

defineType(Selector, 'Selector');